FROM node:lts-alpine as builder

RUN npm i gulp typescript browserify tsify -g

RUN mkdir /app
WORKDIR /app
COPY package*.json /app/
RUN npm install
COPY . /app/
RUN gulp sass

RUN gulp
RUN tsc --build OpenFlow/tsconfig.json

FROM node:lts-alpine
RUN apk add --no-cache bash
EXPOSE 3000
EXPOSE 5858
WORKDIR /data
COPY --from=builder /app/package*.json .
COPY --from=builder /app/dist/ .
RUN npm install --omit=dev

# ENTRYPOINT ["/usr/local/bin/node", "index.js"]
ENTRYPOINT ["/usr/local/bin/node", "--inspect=0.0.0.0:5858", "index.js"]

# docker buildx build --platform linux/amd64 -t openiap/openflow:edge . --push
# docker buildx build --platform linux/amd64 -t openiap/openflow:dev . --push