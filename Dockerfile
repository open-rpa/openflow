FROM node:lts
# FROM node:10.16.0-jessie
EXPOSE 80
EXPOSE 5858
WORKDIR /data
RUN groupadd -r openiapuser && useradd -r -g openiapuser -G audio,video openiapuser \
    && mkdir -p /home/openiapuser/Downloads \
    && chown -R openiapuser:openiapuser /home/openiapuser \
    && chown -R openiapuser:openiapuser /data/

COPY --chown=openiapuser:openiapuser docker-package.json ./package.json
RUN npm install --only=prod
# RUN npm install --production
# RUN npm install --force
COPY --chown=openiapuser:openiapuser dist ./

ENTRYPOINT ["/usr/local/bin/node", "--inspect=0.0.0.0:5858", "index.js"]
