#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { FrontierLatticeStack } from "../lib/frontier-lattice-stack";

const app = new cdk.App();

new FrontierLatticeStack(app, "FrontierLattice", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.AWS_REGION ?? "us-east-1",
  },
  tags: {
    Project: "frontier-lattice",
    Environment: "hackathon",
  },
});
