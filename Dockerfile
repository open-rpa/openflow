FROM node:10.16.0-jessie
EXPOSE 80
EXPOSE 5858
WORKDIR /data
# RUN printf "deb http://archive.debian.org/debian/ jessie main\ndeb-src http://archive.debian.org/debian/ jessie main\ndeb http://security.debian.org jessie/updates main\ndeb-src http://security.debian.org jessie/updates main" > /etc/apt/sources.list
RUN apt update && apt install node-gyp -y
run npm i x509
COPY package*.json ./
RUN npm install
COPY dist ./

ENTRYPOINT ["/usr/local/bin/node", "--inspect=0.0.0.0:5858", "index.js"]