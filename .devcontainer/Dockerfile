ARG VARIANT=16-bullseye
FROM mcr.microsoft.com/devcontainers/javascript-node:0-${VARIANT}
RUN git config --global --add safe.directory /src
RUN npm i gulp typescript browserify tsify -g
