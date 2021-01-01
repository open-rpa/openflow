FROM node:lts
# FROM node:10.16.0-jessie
EXPOSE 80
EXPOSE 5858
WORKDIR /data
COPY docker-package.json ./package.json
RUN npm install
# RUN npm install --force
COPY dist ./

ENTRYPOINT ["/usr/local/bin/node", "--inspect=0.0.0.0:5858", "index.js"]


# FROM node:10.16.0-jessie
# EXPOSE 80
# EXPOSE 5858
# WORKDIR /data
# # RUN printf "deb http://archive.debian.org/debian/ jessie main\ndeb-src http://archive.debian.org/debian/ jessie main\ndeb http://security.debian.org jessie/updates main\ndeb-src http://security.debian.org jessie/updates main" > /etc/apt/sources.list
# RUN apt update && apt install node-gyp -y
# run npm i x509
# COPY package*.json ./
# RUN npm install
# COPY dist ./
# https://medium.com/trendyol-tech/how-we-reduce-node-docker-image-size-in-3-steps-ff2762b51d5a
# ENTRYPOINT ["/usr/local/bin/node", "--inspect=0.0.0.0:5858", "index.js"]

# docker system prune -a
