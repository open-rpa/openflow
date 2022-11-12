FROM node:lts-alpine as builder

RUN npm i gulp typescript browserify tsify -g
RUN mkdir /app
RUN mkdir /app/OpenFlowNodeRED
WORKDIR /app
COPY package*.json /app/
RUN npm install
COPY OpenFlowNodeRED/package*.json /app/OpenFlowNodeRED
WORKDIR /app/OpenFlowNodeRED
RUN npm install
COPY . /app/
RUN tsc --build tsconfig.json
WORKDIR /app
RUN gulp copyfiles1


FROM node:lts-alpine
RUN apk add --no-cache bash git

WORKDIR /data
COPY --from=builder /app/OpenFlowNodeRED/dist/ .
COPY --from=builder /app/OpenFlowNodeRED/node_modules/ ./node_modules/

EXPOSE 3000
EXPOSE 5859

WORKDIR /data

# ENTRYPOINT ["/usr/local/bin/node", "index.js"]
ENTRYPOINT ["/usr/local/bin/node", "--inspect=0.0.0.0:5859", "index.js"]


# docker buildx build --platform linux/amd64 -t openiap/nodered:dev --file ./OpenFlowNodeRED/Dockerfile . --load
# docker buildx build --platform linux/amd64 -t openiap/nodered:dev --file ./OpenFlowNodeRED/Dockerfile . --push