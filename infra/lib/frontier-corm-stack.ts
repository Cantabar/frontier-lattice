import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";

export class FrontierCormStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ================================================================
    // Context — app environment + SUI network
    // ================================================================
    const appEnv: string = this.node.tryGetContext("appEnv") ?? "utopia";
    const prefix = `fc-${appEnv}`; // e.g. fc-utopia, fc-stillness

    const suiNetwork = this.node.tryGetContext("suiNetwork") ?? "testnet";
    const suiRpcUrls: Record<string, string> = {
      testnet: "https://fullnode.testnet.sui.io:443",
      mainnet: "https://fullnode.mainnet.sui.io:443",
    };
    const suiRpcUrl = suiRpcUrls[suiNetwork] ?? suiRpcUrls.testnet;

    const suiGraphqlUrls: Record<string, string> = {
      testnet: "https://graphql.testnet.sui.io/graphql",
      mainnet: "https://graphql.mainnet.sui.io/graphql",
    };
    const suiGraphqlUrl = suiGraphqlUrls[suiNetwork] ?? suiGraphqlUrls.testnet;

    // ================================================================
    // Domain — stillness gets apex, others get {env}.ef-corm.com
    // ================================================================
    const rootDomain = "ef-corm.com";
    const isApex = appEnv === "stillness";
    const siteDomain = isApex ? rootDomain : `${appEnv}.${rootDomain}`;
    const apiDomain = isApex
      ? `api.${rootDomain}`
      : `api.${appEnv}.${rootDomain}`;
    const continuityDomain = isApex
      ? `continuity-engine.${rootDomain}`
      : `continuity-engine.${appEnv}.${rootDomain}`;

    // ================================================================
    // Route 53 — look up existing hosted zone
    // ================================================================
    const zone = route53.HostedZone.fromLookup(this, "Zone", {
      domainName: rootDomain,
    });

    // ================================================================
    // ACM Certificate — covers apex + wildcard
    // ================================================================
    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: rootDomain,
      subjectAlternativeNames: [`*.${rootDomain}`],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    // ================================================================
    // VPC
    // ================================================================
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1, // single NAT to minimise cost
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // ================================================================
    // Security Groups
    // ================================================================
    const albSg = new ec2.SecurityGroup(this, "AlbSg", {
      vpc,
      description: "ALB - public HTTPS",
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP redirect");

    const ecsSg = new ec2.SecurityGroup(this, "EcsSg", {
      vpc,
      description: "ECS tasks",
      allowAllOutbound: true,
    });
    ecsSg.addIngressRule(albSg, ec2.Port.allTcp(), "From ALB");

    const dbSg = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      description: "RDS Postgres",
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(ecsSg, ec2.Port.tcp(5432), "From ECS");

    // ================================================================
    // ECR Repositories
    // ================================================================
    const indexerRepo = new ecr.Repository(this, "IndexerRepo", {
      repositoryName: `${prefix}-indexer`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    const continuityRepo = new ecr.Repository(this, "ContinuityRepo", {
      repositoryName: `${prefix}-continuity-engine`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // ================================================================
    // RDS Postgres
    // ================================================================
    const dbCredentials = new secretsmanager.Secret(this, "DbCredentials", {
      secretName: `${prefix}/db-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "corm" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    const dbParameterGroup = new rds.ParameterGroup(this, "DbParameterGroup", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      parameters: {
        log_min_duration_statement: "1000", // log queries > 1s
        log_statement: "ddl",
      },
    });

    const db = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSg],
      credentials: rds.Credentials.fromSecret(dbCredentials),
      databaseName: "frontier_corm",
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      multiAz: false,
      backupRetention: cdk.Duration.days(3),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      parameterGroup: dbParameterGroup,
      enablePerformanceInsights: true,
      performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
      cloudwatchLogsExports: ["postgresql"],
    });

    // ================================================================
    // Secrets — Sui RPC + session
    // ================================================================
    const suiSecret = new secretsmanager.Secret(this, "SuiRpcSecret", {
      secretName: `${prefix}/sui-rpc`,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({
          SUI_RPC_URL: suiRpcUrl,
          SUI_WS_URL: "",
        })
      ),
      description: `Sui RPC endpoint (${suiNetwork})`,
    });

    // Sui signer keypair — secret value must be populated manually after deploy.
    // Expected JSON: { "SUI_PRIVATE_KEY": "<base64-encoded-ed25519-keypair>" }
    const suiSignerSecret = new secretsmanager.Secret(this, "SuiSignerSecret", {
      secretName: `${prefix}/sui-signer`,
      description: "Sui Ed25519 keypair for continuity-engine on-chain writes",
    });

    const cormStatePackageId: string =
      this.node.tryGetContext("cormStatePackageId") ?? "";
    const cormStateOriginalId: string =
      this.node.tryGetContext("cormStateOriginalId") ?? "";

    // Package IDs for the indexer event subscriber. Read from CDK context
    // so they stay in sync with the publish-contracts.sh output.
    const tribePackageId: string =
      this.node.tryGetContext("tribePackageId") ?? "";
    const trustlessContractsPackageId: string =
      this.node.tryGetContext("trustlessContractsPackageId") ?? "";
    // Additional package/object IDs
    const cormAuthPackageId: string =
      this.node.tryGetContext("cormAuthPackageId") ?? "";
    const cormConfigObjectId: string =
      this.node.tryGetContext("cormConfigObjectId") ?? "";
    const coinAuthorityObjectId: string =
      this.node.tryGetContext("coinAuthorityObjectId") ?? "";
    const cormCharacterId: string =
      this.node.tryGetContext("cormCharacterId") ?? "";

    // ================================================================
    // S3 — Frontend (static site)
    // ================================================================
    const uiBucket = new s3.Bucket(this, "UiBucket", {
      bucketName: `${prefix}-ui-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const cfLogBucket = new s3.Bucket(this, "CfLogBucket", {
      bucketName: `${prefix}-cf-logs-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
    });

    // ================================================================
    // CloudFront
    // ================================================================

    // Sui RPC reverse-proxy: serves /sui-rpc on the same origin as the
    // SPA so the browser treats it as same-origin (no CORS needed).
    const suiFullnodeHost = suiRpcUrl.replace(/^https?:\/\//, "").replace(/:.*/, "");
    const suiOrigin = new origins.HttpOrigin(suiFullnodeHost, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // Indexer API reverse-proxy: serves /api/v1/* on the same origin as
    // the SPA so the browser treats it as same-origin (no CORS needed).
    // Uses the api.{env}.ef-corm.com domain so the ALB's ACM cert validates.
    const albOrigin = new origins.HttpOrigin(apiDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // CloudFront Function: rewrite /sui-rpc → / (Sui JSON-RPC lives at root)
    const suiRpcRewrite = new cloudfront.Function(this, "SuiRpcRewrite", {
      functionName: `${prefix}-sui-rpc-rewrite`,
      code: cloudfront.FunctionCode.fromInline(
        `function handler(event) { event.request.uri = '/'; return event.request; }`
      ),
    });

    const distribution = new cloudfront.Distribution(this, "CfDistribution", {
      domainNames: [siteDomain],
      certificate,
      logBucket: cfLogBucket,
      logFilePrefix: `${prefix}/`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(uiBucket),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        "/sui-rpc": {
          origin: suiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [
            {
              function: suiRpcRewrite,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
        "/api/v1/*": {
          origin: albOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html", // S3 returns 403 for missing keys
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html", // SPA client-side routing
        },
      ],
    });

    // ================================================================
    // ECS Cluster
    // ================================================================
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: `${prefix}-cluster`,
      containerInsights: true,
    });

    // ================================================================
    // ALB
    // ================================================================
    const albLogBucket = new s3.Bucket(this, "AlbLogBucket", {
      bucketName: `${prefix}-alb-logs-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
    });
    alb.logAccessLogs(albLogBucket, prefix);

    const httpsListener = alb.addListener("HttpsListener", {
      port: 443,
      certificates: [certificate],
    });

    // Redirect HTTP → HTTPS
    alb.addListener("HttpRedirect", {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: "HTTPS",
        port: "443",
        permanent: true,
      }),
    });

    // ================================================================
    // Shared log group
    // ================================================================
    const logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/ecs/${prefix}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ================================================================
    // ECS — Indexer Service (subscriber + API on port 3100)
    // ================================================================
    const indexerTaskDef = new ecs.FargateTaskDefinition(
      this,
      "IndexerTaskDef",
      { cpu: 512, memoryLimitMiB: 1024 }
    );

    indexerTaskDef.addContainer("indexer", {
      image: ecs.ContainerImage.fromEcrRepository(indexerRepo, "latest"),
      portMappings: [{ containerPort: 3100 }],
      environment: {
        API_PORT: "3100",
        POLL_INTERVAL_MS: "2000",
        NODE_ENV: "production",
        DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: db.dbInstanceEndpointPort,
        DB_NAME: "frontier_corm",
        PACKAGE_TRIBE: tribePackageId,
        PACKAGE_TRUSTLESS_CONTRACTS: trustlessContractsPackageId,
        SUI_GRAPHQL_URL: suiGraphqlUrl,
      },
      secrets: {
        SUI_RPC_URL: ecs.Secret.fromSecretsManager(suiSecret, "SUI_RPC_URL"),
        DB_USERNAME: ecs.Secret.fromSecretsManager(dbCredentials, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, "password"),
      },
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "indexer",
      }),
      healthCheck: {
        command: [
          "CMD-SHELL",
          "wget -qO- http://localhost:3100/health || exit 1",
        ],
        interval: cdk.Duration.seconds(15),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
      },
    });

    dbCredentials.grantRead(indexerTaskDef.taskRole);
    suiSecret.grantRead(indexerTaskDef.taskRole);

    const indexerService = new ecs.FargateService(this, "IndexerService", {
      cluster,
      taskDefinition: indexerTaskDef,
      desiredCount: 1,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
    });

    // ================================================================
    // ECS — Continuity Engine Service (port 3300)
    // ================================================================
    const continuityTaskDef = new ecs.FargateTaskDefinition(
      this,
      "ContinuityTaskDef",
      { cpu: 512, memoryLimitMiB: 1024 }
    );

    continuityTaskDef.addContainer("continuity-engine", {
      image: ecs.ContainerImage.fromEcrRepository(continuityRepo, "latest"),
      portMappings: [{ containerPort: 3300 }],
      environment: {
        PORT: "3300",
        DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: db.dbInstanceEndpointPort,
        DB_NAME: "frontier_corm",
        CORM_STATE_PACKAGE_ID: cormStatePackageId,
        CORM_STATE_ORIGINAL_ID: cormStateOriginalId,
        TRUSTLESS_CONTRACTS_PACKAGE_ID: trustlessContractsPackageId,
        CORM_AUTH_PACKAGE_ID: cormAuthPackageId,
        CORM_CONFIG_OBJECT_ID: cormConfigObjectId,
        COIN_AUTHORITY_OBJECT_ID: coinAuthorityObjectId,
        CORM_CHARACTER_ID: cormCharacterId,
        SEED_CHAIN_DATA: cormStatePackageId ? "false" : "true",
        ITEM_REGISTRY_PATH: "/data/registry",
        ITEM_VALUES_PATH: "/data/item-values.json",
        SECURE_COOKIES: "true",
      },
      secrets: {
        SUI_RPC_URL: ecs.Secret.fromSecretsManager(suiSecret, "SUI_RPC_URL"),
        SUI_PRIVATE_KEY: ecs.Secret.fromSecretsManager(suiSignerSecret, "SUI_PRIVATE_KEY"),
        DB_USERNAME: ecs.Secret.fromSecretsManager(dbCredentials, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, "password"),
      },
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "continuity-engine",
      }),
      healthCheck: {
        command: [
          "CMD-SHELL",
          "wget -qO- http://localhost:3300/health || exit 1",
        ],
        interval: cdk.Duration.seconds(15),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
      },
    });

    dbCredentials.grantRead(continuityTaskDef.taskRole);
    suiSecret.grantRead(continuityTaskDef.taskRole);
    suiSignerSecret.grantRead(continuityTaskDef.taskRole);

    const continuityService = new ecs.FargateService(this, "ContinuityService", {
      cluster,
      taskDefinition: continuityTaskDef,
      desiredCount: 1,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
    });

    // ================================================================
    // ALB Target Groups + Routing
    // ================================================================
    const indexerTg = httpsListener.addTargets("IndexerTarget", {
      port: 3100,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [indexerService],
      healthCheck: { path: "/health", interval: cdk.Duration.seconds(30) },
      conditions: [elbv2.ListenerCondition.pathPatterns(["/api/v1/*", "/api/v1", "/health"])],
      priority: 10,
    });

    // Sticky sessions required: continuity-engine uses an in-memory session
    // store (puzzle.SessionStore). Without stickiness, scaling desiredCount > 1
    // would route requests to tasks that lack the player's session state.
    const continuityTg = new elbv2.ApplicationTargetGroup(this, "ContinuityTg", {
      port: 3300,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [continuityService],
      healthCheck: { path: "/health", interval: cdk.Duration.seconds(30) },
      vpc,
      stickinessCookieDuration: cdk.Duration.days(1),
    });

    // ALB rules limited to 5 path values per condition — split across rules
    httpsListener.addTargetGroups("ContinuityRule1", {
      targetGroups: [continuityTg],
      conditions: [elbv2.ListenerCondition.pathPatterns(["/api/continuity/*", "/phase0", "/phase0/*", "/puzzle", "/puzzle/*"])],
      priority: 20,
    });
    httpsListener.addTargetGroups("ContinuityRule2", {
      targetGroups: [continuityTg],
      conditions: [elbv2.ListenerCondition.pathPatterns(["/phase2", "/phase2/*", "/stream", "/status", "/contracts"])],
      priority: 21,
    });
    httpsListener.addTargetGroups("ContinuityRule3", {
      targetGroups: [continuityTg],
      conditions: [elbv2.ListenerCondition.pathPatterns(["/ssu/*"])],
      priority: 22,
    });

    // Host-based catch-all: all traffic to the dedicated continuity-engine
    // subdomain routes to the continuity-engine service regardless of path.
    // This ensures the Go service's root "/" → "/phase0" redirect works and
    // static assets (/static/*) are reachable without adding individual path rules.
    httpsListener.addTargetGroups("ContinuityHostRule", {
      targetGroups: [continuityTg],
      conditions: [elbv2.ListenerCondition.hostHeaders([continuityDomain])],
      priority: 5,
    });

    // Default action
    httpsListener.addAction("Default", {
      action: elbv2.ListenerAction.fixedResponse(404, {
        messageBody: "Not Found",
      }),
    });

    // ================================================================
    // Route 53 — DNS records
    // ================================================================
    new route53.ARecord(this, "SiteAliasRecord", {
      zone,
      recordName: siteDomain,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution)
      ),
    });

    new route53.ARecord(this, "ApiAliasRecord", {
      zone,
      recordName: apiDomain,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(alb)
      ),
    });

    new route53.ARecord(this, "ContinuityAliasRecord", {
      zone,
      recordName: continuityDomain,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(alb)
      ),
    });

    // ================================================================
    // Observability — Dashboard
    // ================================================================
    const dashboard = new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: `${prefix}-overview`,
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "ECS CPU Utilization",
        left: [
          indexerService.metricCpuUtilization({ label: "Indexer" }),
          continuityService.metricCpuUtilization({ label: "Continuity Engine" }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "ECS Memory Utilization",
        left: [
          indexerService.metricMemoryUtilization({ label: "Indexer" }),
          continuityService.metricMemoryUtilization({ label: "Continuity Engine" }),
        ],
        width: 12,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "ALB Requests",
        left: [
          new cloudwatch.Metric({
            namespace: "AWS/ApplicationELB",
            metricName: "RequestCount",
            dimensionsMap: { LoadBalancer: alb.loadBalancerFullName },
            statistic: "Sum",
            label: "Requests",
          }),
          new cloudwatch.Metric({
            namespace: "AWS/ApplicationELB",
            metricName: "HTTPCode_Target_5XX_Count",
            dimensionsMap: { LoadBalancer: alb.loadBalancerFullName },
            statistic: "Sum",
            label: "5xx",
          }),
          new cloudwatch.Metric({
            namespace: "AWS/ApplicationELB",
            metricName: "HTTPCode_Target_4XX_Count",
            dimensionsMap: { LoadBalancer: alb.loadBalancerFullName },
            statistic: "Sum",
            label: "4xx",
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "ALB Target Response Time",
        left: [
          new cloudwatch.Metric({
            namespace: "AWS/ApplicationELB",
            metricName: "TargetResponseTime",
            dimensionsMap: { LoadBalancer: alb.loadBalancerFullName },
            statistic: "p50",
            label: "p50",
          }),
          new cloudwatch.Metric({
            namespace: "AWS/ApplicationELB",
            metricName: "TargetResponseTime",
            dimensionsMap: { LoadBalancer: alb.loadBalancerFullName },
            statistic: "p95",
            label: "p95",
          }),
          new cloudwatch.Metric({
            namespace: "AWS/ApplicationELB",
            metricName: "TargetResponseTime",
            dimensionsMap: { LoadBalancer: alb.loadBalancerFullName },
            statistic: "p99",
            label: "p99",
          }),
        ],
        width: 12,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "RDS CPU & Connections",
        left: [db.metricCPUUtilization({ label: "CPU %" })],
        right: [db.metricDatabaseConnections({ label: "Connections" })],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "RDS Storage",
        left: [
          db.metricFreeableMemory({ label: "Freeable Memory" }),
          db.metricFreeStorageSpace({ label: "Free Storage" }),
        ],
        width: 12,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "CloudFront Requests & Errors",
        left: [
          new cloudwatch.Metric({
            namespace: "AWS/CloudFront",
            metricName: "Requests",
            dimensionsMap: {
              DistributionId: distribution.distributionId,
              Region: "Global",
            },
            statistic: "Sum",
            label: "Requests",
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: "AWS/CloudFront",
            metricName: "4xxErrorRate",
            dimensionsMap: {
              DistributionId: distribution.distributionId,
              Region: "Global",
            },
            statistic: "Average",
            label: "4xx %",
          }),
          new cloudwatch.Metric({
            namespace: "AWS/CloudFront",
            metricName: "5xxErrorRate",
            dimensionsMap: {
              DistributionId: distribution.distributionId,
              Region: "Global",
            },
            statistic: "Average",
            label: "5xx %",
          }),
        ],
        width: 12,
      }),
      new cloudwatch.SingleValueWidget({
        title: "ALB Healthy Hosts",
        metrics: [
          new cloudwatch.Metric({
            namespace: "AWS/ApplicationELB",
            metricName: "HealthyHostCount",
            dimensionsMap: {
              TargetGroup: indexerTg.targetGroupFullName,
              LoadBalancer: alb.loadBalancerFullName,
            },
            label: "Indexer",
          }),
          new cloudwatch.Metric({
            namespace: "AWS/ApplicationELB",
            metricName: "HealthyHostCount",
            dimensionsMap: {
              TargetGroup: continuityTg.targetGroupFullName,
              LoadBalancer: alb.loadBalancerFullName,
            },
            label: "Continuity Engine",
          }),
        ],
        width: 12,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.LogQueryWidget({
        title: "Indexer Errors (last 1h)",
        logGroupNames: [logGroup.logGroupName],
        queryLines: [
          'filter @logStream like /indexer/',
          'filter @message like /error|Error|ERROR|WARN|warn/',
          'sort @timestamp desc',
          'limit 20',
        ],
        width: 12,
        height: 8,
      }),
      new cloudwatch.LogQueryWidget({
        title: "Continuity Engine Errors (last 1h)",
        logGroupNames: [logGroup.logGroupName],
        queryLines: [
          'filter @logStream like /continuity-engine/',
          'filter @message like /error|Error|ERROR|WARN|warn/',
          'sort @timestamp desc',
          'limit 20',
        ],
        width: 12,
        height: 8,
      }),
    );

    // ================================================================
    // Observability — Alarms
    // ================================================================
    const alertTopic = new sns.Topic(this, "AlertTopic", {
      topicName: `${prefix}-alerts`,
    });

    new cloudwatch.Alarm(this, "IndexerUnhealthy", {
      alarmName: `${prefix}-indexer-unhealthy`,
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApplicationELB",
        metricName: "HealthyHostCount",
        dimensionsMap: {
          TargetGroup: indexerTg.targetGroupFullName,
          LoadBalancer: alb.loadBalancerFullName,
        },
        statistic: "Minimum",
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      alarmDescription: "Indexer has no healthy targets",
    }).addAlarmAction(new cw_actions.SnsAction(alertTopic));

    new cloudwatch.Alarm(this, "ContinuityUnhealthy", {
      alarmName: `${prefix}-continuity-unhealthy`,
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApplicationELB",
        metricName: "HealthyHostCount",
        dimensionsMap: {
          TargetGroup: continuityTg.targetGroupFullName,
          LoadBalancer: alb.loadBalancerFullName,
        },
        statistic: "Minimum",
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      alarmDescription: "Continuity Engine has no healthy targets",
    }).addAlarmAction(new cw_actions.SnsAction(alertTopic));

    new cloudwatch.Alarm(this, "Alb5xxAlarm", {
      alarmName: `${prefix}-alb-5xx`,
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApplicationELB",
        metricName: "HTTPCode_Target_5XX_Count",
        dimensionsMap: { LoadBalancer: alb.loadBalancerFullName },
        statistic: "Sum",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 10,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "ALB saw >10 5xx responses in 5 minutes",
    }).addAlarmAction(new cw_actions.SnsAction(alertTopic));

    new cloudwatch.Alarm(this, "AlbLatencyAlarm", {
      alarmName: `${prefix}-alb-latency`,
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApplicationELB",
        metricName: "TargetResponseTime",
        dimensionsMap: { LoadBalancer: alb.loadBalancerFullName },
        statistic: "p99",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "ALB p99 latency >5s for 5 minutes",
    }).addAlarmAction(new cw_actions.SnsAction(alertTopic));

    new cloudwatch.Alarm(this, "DbCpuAlarm", {
      alarmName: `${prefix}-db-cpu`,
      metric: db.metricCPUUtilization({ period: cdk.Duration.minutes(5) }),
      threshold: 80,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 2,
      alarmDescription: "RDS CPU >80% for 10 minutes",
    }).addAlarmAction(new cw_actions.SnsAction(alertTopic));

    new cloudwatch.Alarm(this, "DbStorageAlarm", {
      alarmName: `${prefix}-db-storage`,
      metric: db.metricFreeStorageSpace({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 2 * 1024 * 1024 * 1024, // 2 GB
      comparisonOperator:
        cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      alarmDescription: "RDS free storage < 2GB",
    }).addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // ================================================================
    // Outputs
    // ================================================================
    new cdk.CfnOutput(this, "AlbDns", {
      value: alb.loadBalancerDnsName,
      description: "API load balancer DNS",
    });

    new cdk.CfnOutput(this, "SiteUrl", {
      value: `https://${siteDomain}`,
      description: "Frontend URL",
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: `https://${apiDomain}`,
      description: "API URL",
    });

    new cdk.CfnOutput(this, "ContinuityEngineUrl", {
      value: `https://${continuityDomain}`,
      description: "Continuity Engine URL",
    });

    new cdk.CfnOutput(this, "UiBucketName", {
      value: uiBucket.bucketName,
      description: "S3 bucket for frontend deploy",
    });

    new cdk.CfnOutput(this, "IndexerEcrUri", {
      value: indexerRepo.repositoryUri,
      description: "ECR repo for indexer image",
    });

    new cdk.CfnOutput(this, "ContinuityEcrUri", {
      value: continuityRepo.repositoryUri,
      description: "ECR repo for continuity-engine image",
    });

    new cdk.CfnOutput(this, "DbEndpoint", {
      value: db.dbInstanceEndpointAddress,
      description: "RDS Postgres endpoint",
    });

    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
      description: "CloudFront distribution ID (for cache invalidation)",
    });

    new cdk.CfnOutput(this, "DashboardUrl", {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards/dashboard/${prefix}-overview`,
      description: "CloudWatch observability dashboard",
    });
  }
}
