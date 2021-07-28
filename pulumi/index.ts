import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";

// Set Database Password:
// ~$ pulumi config set --stack KongOnEKS --secret kong:dbPassword password
const config = new pulumi.Config("kong");
const dbPassword = config.requireSecret("dbPassword");

////////////////////////////////////////////////////////////////////////////////
// Create a VPC
const vpc = new awsx.ec2.Vpc("keks-vpc", {
  cidrBlock: "172.16.0.0/16",
  numberOfNatGateways: 1,
  numberOfAvailabilityZones: 3,
  subnets: [
    { type: "public",  name: "public"  }, 
  //TODO: enable private subnets
  //  { type: "private", name: "private" }
  ]
},{customTimeouts: {create: "30m"}});

// RDS Security Group
const rdsSecurityGroup = new aws.ec2.SecurityGroup("dbsecgrp", {
  vpcId: vpc.id,
  ingress: [{
    description: "Postgres Listen Port",
    protocol: "tcp",
    fromPort: 5432,
    toPort: 5432,
    cidrBlocks: [vpc.vpc.cidrBlock],
  }],
  egress: [{
    fromPort: 0,
    toPort: 0,
    protocol: "-1",
    cidrBlocks: ["0.0.0.0/0"],
    ipv6CidrBlocks: ["::/0"],
  }],
  tags: {
    Name: "postgresdb_listen_5432"
  }
});

// RDS Subnet attachment
const dbSubnets = new aws.rds.SubnetGroup("dbsubnets", {
  subnetIds: vpc.publicSubnetIds,
  // TODO migrate to private subnet id(s)
  //subnetIds: vpc.privateSubnetIds,
});

// RDS Postgres Database
// - kong configuration store
// https://www.pulumi.com/docs/reference/pkg/aws/rds/instance/
const db = new aws.rds.Instance("postgresdb", {
  name: "kong",
  username: "kong",
  password: dbPassword,
  allocatedStorage: 20,
  engine: "postgres",
  multiAz: true,
  port: 5432,
  vpcSecurityGroupIds: [rdsSecurityGroup.id],
  dbSubnetGroupName: dbSubnets.id,
  instanceClass: "db.t2.micro",
  publiclyAccessible: true,
  skipFinalSnapshot: true,
  tags: {
    Name: "KongOnEKS_PostgresDB"
  }
});

// Create an EKS cluster with the default configuration.
const cluster = new eks.Cluster("keks-cluster", {
  vpcId: vpc.id,
  minSize: 2,
  maxSize: 6,
  desiredCapacity: 3,
  publicSubnetIds: vpc.publicSubnetIds,
  //TODO: enable private subnets
  //privateSubnetIds: vpc.privateSubnetIds,
  nodeAssociatePublicIpAddress: true,
  enabledClusterLogTypes: [
    "api",
    "audit",
    "authenticator",
  ],
},{customTimeouts: {create: "30m"}});


////////////////////////////////////////////////////////////////////////////////
// Export Values
// TODO:
// - deprecate kubeconfig reliance
// - leverage oidc / rbac natively on AWS for api auth

// Create S3 Bucket with KUBECONFIG as object
const keksAdminBucket = new aws.s3.Bucket("keksAdminBucket", {acl: "private"});
const keksAdminBucketObject = cluster.kubeconfig.apply(
  (config) =>
  new aws.s3.BucketObject("keksAdminBucketObject", {
    key: "kubeconfig",
    bucket: keksAdminBucket.id,
    source: new pulumi.asset.StringAsset(JSON.stringify(config)),
    serverSideEncryption: "aws:kms",
}))

// VPC ID
export const vpcId = vpc.id;

// name of admin kubeconfig bucket
export const adminBucketName = keksAdminBucket.id;
