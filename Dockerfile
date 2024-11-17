# FROM node:lts-alpine
# FROM node:22.9.0-alpine3.20 AS base
# FROM node:lts-alpine3.16
FROM node:22.9-slim
# alpine
# RUN apk add --no-cache bash nano
# debian
RUN apt-get update && apt-get install -y nano git curl && rm -rf /var/lib/apt/lists/* 

RUN mkdir /app
WORKDIR /app
COPY package.json /app/
# https://github.com/nodejs/docker-node/issues/1946#issuecomment-2459881919
# ENV NPM_VERSION=10.3.0
# RUN npm install -g npm@"${NPM_VERSION}" --omit=dev --production --no-audit --verbose --force

RUN npm install --omit=dev --production --no-audit --verbose --force
COPY . /app/
RUN npm run build
COPY public /app/dist/public
COPY public.template /app/dist/public.template

WORKDIR /app/dist

ENV HOME=.
EXPOSE 3000
EXPOSE 5858
ENTRYPOINT ["/usr/local/bin/node", "--inspect=0.0.0.0:5858", "index.js"]

# docker buildx build --platform linux/amd64 -t openiap/openflow:edge . --push
# docker buildx build --platform linux/amd64 -t openiap/openflow:dev . --push

# docker run -it --rm openiap/openflow:edge /bin/bash