import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";

// Create a VPC
const vpc = new awsx.ec2.Vpc("keks-vpc", {
    cidrBlock: "172.16.0.0/16",
    numberOfNatGateways: 1,
    numberOfAvailabilityZones: 3,
//    availabilityZones: [
//        'us-east-1a',
//        'us-east-1b',
//        'us-east-1c'
//    ],
    subnets: [
        { type: "public",  name: "public"  }, 
//      { type: "private", name: "private" }
    ]
});

// Create an EKS cluster with the default configuration.
const cluster = new eks.Cluster("keks-cluster", {
    vpcId: vpc.id,
    minSize: 2,
    maxSize: 6,
    desiredCapacity: 3,
    publicSubnetIds: vpc.publicSubnetIds,
//  privateSubnetIds: vpc.privateSubnetIds,
    nodeAssociatePublicIpAddress: true,
    enabledClusterLogTypes: [
        "api",
        "audit",
        "authenticator",
    ],
});

// Create S3 Bucket with KUBECONFIG as object
// TODO move away from kubeconfig reliance & leverage oidc / rbac natively on AWS for api auth
const keksAdminBucket = new aws.s3.Bucket("keksAdminBucket", {acl: "private"});
const keksAdminBucketObject = cluster.kubeconfig.apply(
  (config) =>
    new aws.s3.BucketObject("keksAdminBucketObject", {
      key: "kubeconfig",
      bucket: keksAdminBucket.id,
      source: new pulumi.asset.StringAsset(JSON.stringify(config)),
      serverSideEncryption: "aws:kms",
}))

// Export Values
// Subnet ID's
export const vpcPublicSubnetIds = vpc.publicSubnetIds;
export const vpcPrivateSubnetIds = vpc.privateSubnetIds;
// export const subnetPublicAZs = () => {
//   return vpc.getSubnets("public").map(x => x.subnet.availabilityZoneId);
// };

// VPC ID
export const vpcId = vpc.id;
// Export the name of the bucket
export const adminBucketName = keksAdminBucket.id;
// Export the cluster's kubeconfig.
export const kubeconfig = cluster.kubeconfig;
