FROM node:latest
EXPOSE 80
EXPOSE 5858
WORKDIR /data
COPY package*.json ./
RUN npm install
COPY dist ./

ENTRYPOINT ["/usr/local/bin/node", "--inspect=0.0.0.0:5858", "index.js"]
