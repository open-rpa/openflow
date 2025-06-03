FROM node:20 AS build-env
WORKDIR /app

RUN npm i -g typescript
COPY package.json /app/
COPY package-lock.json /app/
RUN npm ci --omit=dev
COPY . /app
RUN npm run build

# https://github.com/GoogleContainerTools/distroless
FROM gcr.io/distroless/nodejs20-debian12
COPY --from=build-env /app /app
COPY public /app/dist/public
COPY public.template /app/dist/public.template
WORKDIR /app/dist

ENV HOME=.
EXPOSE 3000
EXPOSE 5858
CMD ["--inspect=0.0.0.0:5858", "index.js"]
