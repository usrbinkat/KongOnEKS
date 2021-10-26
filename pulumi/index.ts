import * as aws    from "@pulumi/aws";
import * as eks    from "@pulumi/eks";
import * as k8s    from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as awsx   from "@pulumi/awsx";


////////////////////////////////////////////////////////////////////////////////
// Set Variables:
//   ~$ pulumi config set --stack KongOnEKS --secret kong:dbPassword password
const kongConfig = new pulumi.Config("kong")
const dbPassword = kongConfig.requireSecret("dbPassword")
const eksConfig = new pulumi.Config("eksCluster")
const clusterName = eksConfig.require("clusterName")


////////////////////////////////////////////////////////////////////////////////
// Create a VPC
// TODO: variablize cluster name
// TODO: implement tagging on all resources
const vpc = new awsx.ec2.Vpc(`${clusterName}-vpc`, {
  cidrBlock: "172.16.0.0/16",
  numberOfNatGateways: 1,
  numberOfAvailabilityZones: 3,
  tags: {
    Name: `${clusterName}`
  },
  subnets: [
    { type: "public",  name: "public"  }, 
  //TODO: enable vpc private subnets
  //  { type: "private", name: "private" }
  ]
},{customTimeouts: {create: "30m"}})
export const vpcId = vpc.id;


////////////////////////////////////////////////////////////////////////////////
// Create RDS Kong Configuration Data Store
//
// Terraform for review & enhancement considerations
// - https://github.com/hashicorp/terraform-provider-aws/tree/master/examples/rds

// TODO: variablize instance type
// TODO: variablize database name
// TODO: variablize database uname
// TODO: disable publicly accessible
// TODO: variablize allocated storage
// TODO: convert rds.Instance to rds.Cluster
// REF: https://www.pulumi.com/docs/reference/pkg/aws/rds/instance/
// REF: https://www.pulumi.com/docs/guides/crosswalk/aws/vpc/#configuring-subnets-for-a-vpc
// REF: https://github.com/pulumi/pulumi-aws/blob/0b73446ce5361fcd9f313d7e5ac36e5668936d31/sdk/nodejs/rds/cluster.ts#L75
// REF: https://www.lastweekinaws.com/blog/aurora-vs-rds-an-engineers-guide-to-choosing-a-database/

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
  // TODO migrate rds to private subnet id(s)
  //subnetIds: vpc.privateSubnetIds,
  tags: {
    Name: `${clusterName}-rdsPostgresSubnetGroup`
  },
});

// RDS Postgres Database
const db = new aws.rds.Instance("postgresdb", {
  name: "kong",
  username: "kong",
  password: dbPassword,
  instanceClass: "db.t3.micro",
  publiclyAccessible: true,
  allocatedStorage: 20,
  engine: "postgres",
  multiAz: true,
  port: 5432,
  applyImmediately: true,
  vpcSecurityGroupIds: [rdsSecurityGroup.id],
  dbSubnetGroupName: dbSubnets.id,
  skipFinalSnapshot: true,
  tags: {
    Name: `${clusterName}-rdsPostgresDB`
  }
},{customTimeouts: {create: "30m"}});
export const rdsIp = db.address;


////////////////////////////////////////////////////////////////////////////////
// EKS cluster
const cluster = new eks.Cluster(`${clusterName}-cluster`, {
  vpcId: vpc.id,
  minSize: 2,
  maxSize: 6,
  desiredCapacity: 3,
  publicSubnetIds: vpc.publicSubnetIds,
  //TODO: convert eks to private subnets
  //privateSubnetIds: vpc.privateSubnetIds,
  nodeAssociatePublicIpAddress: true,
  enabledClusterLogTypes: [
    "api",
    "audit",
    "authenticator",
  ],
},{customTimeouts: {create: "120m"}});

// Export the cluster's kubeconfig.
export const kubeconfig = cluster.kubeconfig;

// Configure EKS KUBECONFIG provider
export const provider = new k8s.Provider("k8s", {kubeconfig: kubeconfig})

// Create S3 Bucket with KUBECONFIG as object
// Pull kubeconfig from s3 via aws cli:
//   ~$ aws s3 cp s3://$(pulumi stack --stack KongOnEKS output adminBucketName)/kubeconfig ~/.kube/config
const keksAdminBucket = new aws.s3.Bucket("keksAdminBucket", {acl: "private"});
const keksAdminBucketObject = cluster.kubeconfig.apply(
  (config) =>
  new aws.s3.BucketObject("keksAdminBucketObject", {
    key: "kubeconfig",
    bucket: keksAdminBucket.id,
    serverSideEncryption: "aws:kms",
    source: cluster.kubeconfig.apply(s => new pulumi.asset.StringAsset(JSON.stringify(s))),
}))
export const adminBucketName = keksAdminBucket.id;

// create namespace 'kong'
const namespace = new k8s.core.v1.Namespace("ns", {metadata: {name: "kong",}},{provider: provider});


////////////////////////////////////////////////////////////////////////////////
// Kong Enterprise Controlplane from kong/kong helm chart

// Deploy Kong Enterprise Controlplane from kong/kong helm chart.
// TODO:
//   - RFE: https://github.com/pulumi/pulumi-kubernetes/issues/555
//   - Pulumi support for helm hooks still in progress
const kongGatewayCP = new k8s.helm.v3.Chart("controlplane", {
  repo: "kong",
  chart: "kong",
  namespace: "kong",
  fetchOpts: {repo: "https://charts.konghq.com/"},
  values: {
    plugins: "bundled,openid-connect",
    replicaCount: "2",
    secretVolumes: ["kong-cluster-cert","kong-tls"],
    deployment: {kong: {enabled: true, daemonset: false}},
    deploymentAnnotations: {"kuma.io/gateway": "enabled"},
    proxy: {enabled: false},
    env: {
      prefix: "/kong_prefix/",
      database: "postgres",
      // TODO: variablize log_level
      log_level: "debug",
      smtp_mock: "on",
      vitals: "on",
      anonymous_reports: "off",
      nginx_worker_processes: "2",
      // TODO: variablize postgres user/db/port from config
      pg_user: "kong",
      pg_database: "kong",
      pg_host: rdsIp, 
      pg_port: "5432",
      pg_password: dbPassword,
      // TODO: convert super admin password to `valueFrom Secret`
      password: "password",
      cluster_cert: "/etc/secrets/kong-cluster-cert/tls.crt",
      cluster_cert_key: "/etc/secrets/kong-cluster-cert/tls.key",
      audit_log: "on",
      // kong admin api and manager tuneables
      admin_gui_protocol: "https",
      admin_api_uri: "https://kong.hbfs.io",
      admin_gui_url: "https://manager.kong.hbfs.io",
      admin_ssl_cert: "/etc/secrets/kong-tls/tls.crt",
      admin_ssl_cert_key: "/etc/secrets/kong-tls/tls.key",
      admin_gui_ssl_cert: "/etc/secrets/kong-tls/tls.crt",
      admin_gui_ssl_cert_key: "/etc/secrets/kong-tls/tls.key",
      admin_gui_access_log: "/dev/stdout",
      admin_gui_error_log: "/dev/stdout",
      admin_access_log: "/dev/stdout",
      admin_error_log: "/dev/stdout",
      // kong portal web interface and portal api tuneables
      portal: "on",
      portal_cors_origins: "*",
      portal_gui_protocol: "https",
      portal_gui_url: "https://portal.kong.hbfs.io/",
      portal_api_uri: "https://portal.kong.hbfs.io/api",
      portal_gui_host: "portal.kong.hbfs.io",
      portal_gui_access_log: "/dev/stdout",
      portal_api_access_log: "/dev/stdout",
      portal_gui_error_log: "/dev/stdout",
      portal_api_error_log: "/dev/stdout",
      portal_auth: "basic-auth",
      portal_session_conf: {
        valueFrom: {
          secretKeyRef: {
            name: "kong-session-config",
            key: "portal_session_conf"
          }
        }
      }
    },
    cluster: {
      enabled: true,
      tls: {
        enabled: true,
        servicePort: 8005,
        containerPort: 8005,
        parameters: []
      },
      type: "ClusterIP"
    },
    status: {
      enabled: true,
      http: {
        enabled: true,
        servicePort: 8100,
        containerPort: 8100,
        parameters: []
      },
      tls: {enabled: false},
    },
    ingressController: {
      enabled: true,
      args: ["--v=5"],
      installCRDs: false,
      env: {
        publish_service: "kong/controlplane-kong-cluster",
        kong_admin_tls_skip_verify: true,
        kong_admin_token: {
          valueFrom: {
            secretKeyRef: {
              name: "kong-enterprise-superuser-password",
              key: "password"
            }
          }
        }
      },
      admissionWebhook: {
        enabled: true,
        failurePolicy: "Fail",
        port: 8080
      },
      ingressClass: "kong",
      rbac: {create: true},
      serviceAccount: {create: true}
    },
    enterprise: {
      enabled: true,
      rbac: {
        enabled: true,
        admin_gui_auth: "basic-auth",
        session_conf_secret: "kong-session-config",
        admin_gui_auth_conf_secret: "kong-admin-gui-auth-conf-secret"
      },
      license_secret: "kong-enterprise-license",
      vitals: {enabled: true},
      portal: {enabled: true},
      smtp: {enabled: true}
    },
    manager: {
      enabled: true,
      type: "LoadBalancer",
      http: {
        enabled: true,
        servicePort: 8002,
        containerPort: 8002,
        parameters: []
      },
      tls: {
        enabled: true,
        servicePort: "8445",
        containerPort: "8445",
        parameters: ["http2"]
      },
      ingress: {
        enabled: true,
        annotations: {"kubernetes.io/ingress.class": "kong"},
        hostname: "manager.kong.hbfs.io",
        tls: "manager.kong.hbfs.io",
        path: "/"
      },
      annotations: {"konghq.com/protocol": "https"}
    }
  },
},{
  parent: namespace,
  providers: {kubernetes: provider}
  //customTimeouts: {create: "10m"}
});
/*

proxy:
  enabled: true
  type: LoadBalancer
  annotations: {
    "service.beta.kubernetes.io/aws-load-balancer-backend-protocol": "https",
    "service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled": "true",
    "service.beta.kubernetes.io/aws-load-balancer-ssl-cert": "arn:aws:acm:us-west-2:XXXXXXXX:certificate/XXXXXX-XXXXXXX-XXXXXXX-XXXXXXXX",
    "service.beta.kubernetes.io/aws-load-balancer-ssl-ports": "kong-proxy-tls",
    "service.beta.kubernetes.io/aws-load-balancer-type": "elb"
  }
  
  kong-proxy-tls
  overrideServiceTargetPort
  service.beta.kubernetes.io/aws-load-balancer-ssl-ports

    },
    manager: {
      enabled: true,
      type: "ClusterIP",
      annotations: {
        "konghq.com/protocol": "https"
      },
      http: {enabled: false},
      tls: {
        enabled: true,
        servicePort: 8445,
        containerPort: 8445,
        parameters: ["http2"]
      },
      ingress: {
        enabled: true,
        annotations: {
          "kubernetes.io/ingress.class": "kong"
        },
        tls: "manager.kong.hbfs.io",
        hostname: "manager.kong.hbfs.io",
        path: "/"
      },
      labels: ""
    },
    portal: {
      enabled: true,
      type: "ClusterIP",
      annotations: {
        "konghq.com/protocol": "https"
      },
      http: {
        enabled: true,
        servicePort: 8003,
        containerPort: 8003,
        parameters: []
      },
      tls: {
        enabled: true,
        servicePort: 8446,
        containerPort: 8446,
        parameters: ["http2"]
      },
      ingress: {
        enabled: true,
        annotations: {
          "kubernetes.io/ingress.class": "kong"
        },
        tls: "portal.kong.hbfs.io",
        hostname: "portal.kong.hbfs.io",
        path: "/"
      },
      labels: "{}"
    },
    portalapi: {
      enabled: true,
      type: "ClusterIP",
      annotations: {
        "konghq.com/protocol": "https"
      },
      http: {
        enabled: true,
        servicePort: 8004,
        containerPort: 8004,
        parameters: []
      },
      tls: {
        enabled: true,
        servicePort: 8447,
        containerPort: 8447,
        parameters: ["http2"]
      },
      ingress: {
        enabled: true,
        annotations: {
          "kubernetes.io/ingress.class": "kong"
        },
        tls: "papi.kong.hbfs.io",
        hostname: "papi.kong.hbfs.io",
        path: "/"
      },
      labels: "{}"
    },
    admin: {
      enabled: true,
      type: "ClusterIP",
      annotations: {
        "konghq.com/protocol": "https"
      },
      http: {enabled: false,},
      tls: {
        enabled: true,
        servicePort: 8444,
        containerPort: 8444,
        parameters: ["http2"]
      },
      ingress: {
        enabled: true,
        annotations: {
          "kubernetes.io/ingress.class": "kong"
        },
        tls: "manager.kong.hbfs.io",
        hostname: "manager.kong.hbfs.io",
        path: "/"
      },
      labels: "{}"
    },
    */


////////////////////////////////////////////////////////////////////////////////
// Kong Enterprise Dataplane from kong/kong helm chart

// TODO: automate controlplane / dataplane pki trust secret
// TODO: resolve Duplicate Resource URN
/*
  REF: https://www.pulumi.com/docs/intro/concepts/resources/#urns
  Error:
    Diagnostics:
      kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition (kongplugins.configuration.konghq.com):
        error: Duplicate resource URN 'urn:pulumi:KongHybridGatewayOnEKS::Gateway::kubernetes:helm.sh/v3:Chart$kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition::kongplugins.configuration.konghq.com'; try giving it a unique name
const kongGatewayDP = new k8s.helm.v3.Chart("dataplane", {
  repo: "kong",
  chart: "kong",
  namespace: "kong",
  skipCRDRendering: true,
  fetchOpts:{
    repo: "https://charts.konghq.com/",
  },
  values: {
    env: {
      database: "off",
      role: "data_plane",
      prefix: "/kong_prefix/",
      cluster_cert: "/etc/secrets/kong-cluster-cert/tls.crt",
      cluster_cert_key: "/etc/secrets/kong-cluster-cert/tls.key",
      lua_ssl_trusted_certificate: "/etc/secrets/kong-cluster-cert/tls.crt",
      cluster_control_plane: "controlplane-kong-cluster.kong.svc.cluster.local:8005"
    },
    proxy: {enabled: true},
    admin: {enabled: false},
    portal: {enabled: false},
    cluster: {enabled: false},
    manager: {enabled: false},
    portalapi: {enabled: false},
    secretVolumes: ["kong-cluster-cert"],
    ingressController: {enabled: false, installCRDs: false}
  },
},{
  parent: kongGatewayCP,
  providers: {kubernetes: provider},
  customTimeouts: {create: "10m"}
});
*/


////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
/*

////////////////////////////////////////////////////////////////////////////////
Notes:
  Download kubeconfig from s3 via command:
    ~$ aws s3 cp s3://$(pulumi stack --stack KongOnEKS output adminBucketName)/kubeconfig ~/.kube/config


////////////////////////////////////////////////////////////////////////////////
REFERENCES:
  - https://github.com/Kong/aws-marketplace/blob/master/K4K8S/Kong%20for%20Kubernetes%20Enterprise.md
  - https://www.pulumi.com/docs/intro/concepts/secrets/#using-configuration-and-secrets-in-code


////////////////////////////////////////////////////////////////////////////////
  TODO: deprecate kubeconfig reliance
  TODO: leverage oidc / rbac natively on AWS for api auth

  TODO: Convert Secrets Management to AWS kms
    - https://www.pulumi.com/docs/reference/cli/pulumi_stack_init/#pulumi-stack-init
    - https://www.pulumi.com/docs/intro/concepts/secrets/#aws-key-management-service-kms

  TODO: Create pulumi func for kong-enterprise-license
    - (workaround) ~$ kubectl create secret generic kong-enterprise-license -n kong --from-file=/tmp/license

  TODO: Create Pulumi func for super admin password
    - (workaround) ~$ kubectl create secret generic kong-enterprise-superuser-password -n kong --from-literal=password=password

  TODO: Create modular structure for IaC
    - https://github.com/pulumi/examples/tree/master/classic-azure-ts-cosmosapp-component

  TODO: Create Pulumi func for kong manager & dev portal web gui session configuration
    - (workaround) ~$ 
cat <<EOF | tee /tmp/admin_gui_session_conf
{"cookie_name":"admin_session","cookie_samesite":"off","secret":"password","cookie_secure":false,"storage":"kong"}
EOF
    - (workaround) ~$
cat <<EOF | tee /tmp/portal_session_conf
{"cookie_name":"portal_session","cookie_samesite":"off","secret":"password","cookie_secure":false,"storage":"kong"}
EOF
    - (workaround) ~$ kubectl create secret generic kong-session-config -n kong --from-file=/tmp/admin_gui_session_conf --from-file=/tmp/portal_session_conf

  TODO: Create Kong License Kubernetes Secret
const secretDatabaseConnection = new k8s.core.v1.Secret("kong-database-connect-string", {
    stringData: {
      kongDbPassword: dbPassword, // or could be process.env.DB_SECRET probably or some variation
    },
},{provider: provider});
*/