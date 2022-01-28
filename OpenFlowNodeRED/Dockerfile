FROM node:lts-alpine
EXPOSE 80
EXPOSE 5859

WORKDIR /data
# alpine
RUN addgroup -S openiapuser && adduser -S openiapuser -G openiapuser \
    && mkdir -p /home/openiapuser/Downloads \
    && chown -R openiapuser:openiapuser /home/openiapuser \
    && chown -R openiapuser:openiapuser /data/
# full image
# RUN groupadd -r openiapuser && useradd -r -g openiapuser -G audio,video openiapuser \
#     && mkdir -p /home/openiapuser/Downloads \
#     && chown -R openiapuser:openiapuser /home/openiapuser \
#     && chown -R openiapuser:openiapuser /data/
# Run everything after as non-privileged user.
USER openiapuser

COPY --chown=openiapuser:openiapuser docker-package.json ./package.json
RUN npm install --only=prod
# RUN npm install
COPY --chown=openiapuser:openiapuser dist ./

ENTRYPOINT ["/usr/local/bin/node", "--inspect=0.0.0.0:5859", "index.js"]
