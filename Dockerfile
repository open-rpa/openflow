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
