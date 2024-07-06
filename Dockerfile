FROM node:lts-alpine
RUN apk add --no-cache bash nano
RUN mkdir /app
WORKDIR /app
COPY package.json /app/
RUN npm install --omit=dev --production --verbose
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