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
        { type: "private", name: "private" }
    ]
});

// Create an S3 Bucket
const bucket = new aws.s3.Bucket("keks-s3");

// Create an EKS cluster with the default configuration.
const cluster = new eks.Cluster("keks-cluster", {
    vpcId: vpc.id,
    minSize: 2,
    maxSize: 6,
    desiredCapacity: 3,
    publicSubnetIds: vpc.publicSubnetIds,
    privateSubnetIds: vpc.privateSubnetIds,
    nodeAssociatePublicIpAddress: false,
    enabledClusterLogTypes: [
        "api",
        "audit",
        "authenticator",
    ],
});

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
export const bucketName = bucket.id;
// Export the cluster's kubeconfig.
export const kubeconfig = cluster.kubeconfig;
