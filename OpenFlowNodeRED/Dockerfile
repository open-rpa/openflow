FROM node:latest
EXPOSE 80
EXPOSE 5859
WORKDIR /data
COPY package*.json ./
RUN npm install
COPY dist ./

ENTRYPOINT ["/usr/local/bin/node", "--inspect=0.0.0.0:5859", "index.js"]
