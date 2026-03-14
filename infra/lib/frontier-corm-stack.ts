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
import * as iam from "aws-cdk-lib/aws-iam";

export class FrontierCormStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const prefix = "fc"; // short prefix for resource names

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

    const apiRepo = new ecr.Repository(this, "ApiRepo", {
      repositoryName: `${prefix}-api-service`,
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
    });

    // ================================================================
    // Secrets — Sui RPC + session
    // ================================================================
    const suiSecret = new secretsmanager.Secret(this, "SuiRpcSecret", {
      secretName: `${prefix}/sui-rpc`,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({
          SUI_RPC_URL: "https://fullnode.testnet.sui.io:443",
          SUI_WS_URL: "",
        })
      ),
      description: "Update with actual Sui RPC endpoint after deployment",
    });

    const sessionSecret = new secretsmanager.Secret(this, "SessionSecret", {
      secretName: `${prefix}/session-secret`,
      generateSecretString: {
        excludePunctuation: false,
        passwordLength: 64,
      },
    });

    // ================================================================
    // S3 — Frontend (static site)
    // ================================================================
    const uiBucket = new s3.Bucket(this, "UiBucket", {
      bucketName: `${prefix}-ui-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ================================================================
    // S3 — Encrypted contract blobs
    // ================================================================
    const encryptedBucket = new s3.Bucket(this, "EncryptedBucket", {
      bucketName: `${prefix}-encrypted-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(90) }],
    });

    // ================================================================
    // CloudFront — serves the React UI from S3
    // ================================================================
    const distribution = new cloudfront.Distribution(this, "CfDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(uiBucket),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
      errorResponses: [
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
      containerInsights: false, // save cost for hackathon
    });

    // ================================================================
    // ALB
    // ================================================================
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
    });

    const listener = alb.addListener("HttpListener", {
      port: 80,
      // For hackathon, use HTTP. Add ACM cert + HTTPS listener for production.
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
    // Helper: build DATABASE_URL from RDS secret
    // ================================================================
    const dbUrl = `postgresql://${dbCredentials
      .secretValueFromJson("username")
      .unsafeUnwrap()}:${dbCredentials
      .secretValueFromJson("password")
      .unsafeUnwrap()}@${db.dbInstanceEndpointAddress}:${db.dbInstanceEndpointPort}/frontier_corm`;

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
        DATABASE_URL: dbUrl,
      },
      secrets: {
        SUI_RPC_URL: ecs.Secret.fromSecretsManager(suiSecret, "SUI_RPC_URL"),
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
    // ECS — API Service (auth + optimizer + privacy)
    // ================================================================
    const apiTaskDef = new ecs.FargateTaskDefinition(this, "ApiTaskDef", {
      cpu: 512,
      memoryLimitMiB: 1024,
    });

    apiTaskDef.addContainer("api", {
      image: ecs.ContainerImage.fromEcrRepository(apiRepo, "latest"),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        NODE_ENV: "production",
        S3_BUCKET_ENCRYPTED: encryptedBucket.bucketName,
      },
      secrets: {
        SUI_RPC_URL: ecs.Secret.fromSecretsManager(suiSecret, "SUI_RPC_URL"),
        SESSION_SECRET: ecs.Secret.fromSecretsManager(sessionSecret),
      },
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "api",
      }),
    });

    encryptedBucket.grantReadWrite(apiTaskDef.taskRole);
    suiSecret.grantRead(apiTaskDef.taskRole);
    sessionSecret.grantRead(apiTaskDef.taskRole);

    const apiService = new ecs.FargateService(this, "ApiService", {
      cluster,
      taskDefinition: apiTaskDef,
      desiredCount: 1,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
    });

    // ================================================================
    // ALB Target Groups + Routing
    // ================================================================
    const indexerTg = listener.addTargets("IndexerTarget", {
      port: 3100,
      targets: [indexerService],
      healthCheck: { path: "/health", interval: cdk.Duration.seconds(30) },
      conditions: [elbv2.ListenerCondition.pathPatterns(["/api/indexer/*"])],
      priority: 10,
    });

    const apiTg = listener.addTargets("ApiTarget", {
      port: 3000,
      targets: [apiService],
      healthCheck: { path: "/health", interval: cdk.Duration.seconds(30) },
      conditions: [
        elbv2.ListenerCondition.pathPatterns([
          "/api/auth/*",
          "/api/optimizer/*",
          "/api/privacy/*",
        ]),
      ],
      priority: 20,
    });

    // Default action — return 404 for unmatched paths
    listener.addAction("Default", {
      action: elbv2.ListenerAction.fixedResponse(404, {
        messageBody: "Not Found",
      }),
    });

    // ================================================================
    // Outputs
    // ================================================================
    new cdk.CfnOutput(this, "AlbDns", {
      value: alb.loadBalancerDnsName,
      description: "API load balancer DNS",
    });

    new cdk.CfnOutput(this, "CloudFrontUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "Frontend URL",
    });

    new cdk.CfnOutput(this, "UiBucketName", {
      value: uiBucket.bucketName,
      description: "S3 bucket for frontend deploy",
    });

    new cdk.CfnOutput(this, "EncryptedBucketName", {
      value: encryptedBucket.bucketName,
      description: "S3 bucket for encrypted contract blobs",
    });

    new cdk.CfnOutput(this, "IndexerEcrUri", {
      value: indexerRepo.repositoryUri,
      description: "ECR repo for indexer image",
    });

    new cdk.CfnOutput(this, "ApiEcrUri", {
      value: apiRepo.repositoryUri,
      description: "ECR repo for API service image",
    });

    new cdk.CfnOutput(this, "DbEndpoint", {
      value: db.dbInstanceEndpointAddress,
      description: "RDS Postgres endpoint",
    });

    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
      description: "CloudFront distribution ID (for cache invalidation)",
    });
  }
}
