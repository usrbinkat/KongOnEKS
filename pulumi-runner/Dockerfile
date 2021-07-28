#################################################################################
# Builder Image
FROM registry.access.redhat.com/ubi8/ubi as builder
ARG BUILD_PATH='/rootfs'

#################################################################################
# DNF Package Install List
ARG DNF_LIST1="\
  tar \
  git \
  bash \
  curl \
  which \
  unzip \
  rsync \
  bsdtar \
  openssl \
  python3 \
  python3-pip \
  coreutils-single \
  glibc-minimal-langpack \
"
ARG NPM_LIST="\
  @pulumi/eks \
  @pulumi/awsx \
  @pulumi/pulumi \
  @pulumi/kubernetes \
"

#################################################################################
# DNF Package Install Flags
ARG DNF_FLAGS="\
  -y \
  --releasever 8 \
  --installroot /rootfs \
"
ARG DNF_FLAGS_EXTRA="\
  --nodocs \
  --setopt=install_weak_deps=false \
  ${DNF_FLAGS} \
"

#################################################################################
# Build Rootfs
RUN set -ex \
     && mkdir -p ${BUILD_PATH}                                                               \
     && dnf -y module reset nodejs                                                           \
     && dnf -y module enable nodejs:12                                                       \
     && dnf install ${DNF_FLAGS_EXTRA} ${DNF_LIST1}                                          \
     && cp -f /etc/yum.repos.d/ubi.repo ${BUILD_PATH}/etc/yum.repos.d/ubi.repo               \
     && cp -f /etc/yum.repos.d/redhat.repo ${BUILD_PATH}/etc/yum.repos.d/redhat.repo         \
     && cp -f /etc/dnf/modules.d/nodejs.module ${BUILD_PATH}/etc/dnf/modules.d/nodejs.module \
     && dnf install -y --setopt=tsflags=nodocs                                               \
                       --installroot /rootfs nodejs npm nodejs-nodemon nss_wrapper           \
     && dnf clean all ${DNF_FLAGS}                                                           \
     && rm -rf ${BUILD_PATH}/var/cache/*                                                     \
     && mkdir -p ${BUILD_PATH}/root/.kube                                                    \
    && echo

#################################################################################
# Build Image from Rootfs
FROM scratch
COPY --from=builder /rootfs /

# Add static artifacts from repo
ADD ./rootfs /

# Test Node & NPM Installation
RUN set -ex \
     && npm --version \
     && node --version \
    && echo

RUN set -ex \
     && python3 -m pip install --upgrade \
                   pip \
                   boto \
                   boto3 \
                   botocore \
    && echo

# Install helm cli
ARG varverhelm="${varVerHelm}"
ARG varUrlHelm="https://get.helm.sh/helm-v${varverhelm}-linux-amd64.tar.gz"
RUN set -ex                                                                     \
     && curl -L ${varUrlHelm}                                                   \
        | tar xzvf - --directory /tmp linux-amd64/helm                          \
     && mv /tmp/linux-amd64/helm /bin/helm                                      \
     && rm -rf /tmp/linux-amd64                                                 \
     && chmod +x /bin/helm                                                      \
     && /bin/helm version                                                       \
     && helm repo add kong https://charts.konghq.com                            \
     && helm repo update                                                        \
    && echo

# Install AWS CLI v2
ARG urlAwsCli="https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip"
RUN set -ex \
     && mkdir -p /tmp/aws                                                       \
     && cd /tmp/aws                                                             \
     && curl ${urlAwsCli} --output /tmp/aws/awscliv2.zip                        \
     && unzip awscliv2.zip                                                      \
     && ./aws/install                                                           \
     && aws --version || exit 1                                                 \
     && rm -rf /tmp/aws                                                         \
    && echo

# Add Kubectl Binary
ARG varverkubectl=${varverkubectl}
ENV varverkubectl=${varverkubectl}
ARG urlKubectl="https://storage.googleapis.com/kubernetes-release/release/${varverkubectl}/bin/linux/amd64/kubectl"
RUN set -ex \
     && curl -L ${urlKubectl} --output /bin/kubectl                             \
     && chmod +x /bin/kubectl                                                   \
     && kubectl version --client --short || exit 1                              \
    && echo

# Add Pulumi binary
ARG varverpulumi="${varverpulumi}"
ENV varverpulumi="${varverpulumi}"
ARG urlPulumiBin="https://github.com/pulumi/pulumi/releases/download/v${varverpulumi}/pulumi-v${varverpulumi}-linux-x64.tar.gz"
RUN set -ex \
     && curl -L ${urlPulumiBin}                                                 \
        | tar xzvf - --directory /tmp                                           \
     && mv /tmp/pulumi/* /usr/local/bin/                                        \
     && rm -rf /tmp/pulumi                                                      \
     && pulumi version                                                          \
    && echo

# Add static artifacts from repo
ADD ./rootfs /

ENV \
  KUBECONFIG=/root/.kube/config \
  PULUMI_CONFIG_PASSPHRASE=pulumi
WORKDIR /pulumi
CMD ["/entrypoint.sh"]

#################################################################################
# Finalize Image
MAINTAINER use-at-your-own-risk
LABEL \
  license=GPLv3                                                                 \
  name="kong-pulumi-runner"                                                     \
  distribution-scope="public"                                                   \
  io.k8s.display-name="kong-pulumi-runner"                                      \
  summary="Containerized Pulumi Runner image for Kong on EKS"                   \
  description="Containerized Pulumi Runner image for Kong on EKS"               \
  io.k8s.description="Containerized Pulumi Runner image for Kong on EKS"
