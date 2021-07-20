#!/bin/bash
pulumi login --local
pulumi new aws-typescript --yes --generate-only --name KongOnFargate --description KongOnFargate --non-interactive
npm install
