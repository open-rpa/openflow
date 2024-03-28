FROM node:lts-alpine as builder
# --omit=optional
RUN npm install gulp typescript browserify tsify -g

RUN mkdir /app
WORKDIR /app
COPY package*.json /app/
RUN npm install --verbose
COPY . /app/
RUN gulp sass

RUN gulp
RUN tsc --build OpenFlow/tsconfig.json

FROM node:lts-alpine
ENV NODE_ENV=production
RUN apk add --no-cache bash nano
EXPOSE 3000
EXPOSE 5858
WORKDIR /data
COPY --from=builder /app/package*.json .
COPY --from=builder /app/dist/ .
# RUN npm install --omit=dev 
# RUN npm install mongodb
ENV HOME=.
RUN npm install --omit=dev --production --verbose

# ENTRYPOINT ["/usr/local/bin/node", "index.js"]
ENTRYPOINT ["/usr/local/bin/node", "--inspect=0.0.0.0:5858", "index.js"]

# docker buildx build --platform linux/amd64 -t openiap/openflow:edge . --push
# docker buildx build --platform linux/amd64 -t openiap/openflow:dev . --push