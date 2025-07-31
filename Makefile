.PHONY: build

VERSION = 1.5.12.24
HASH = $(shell git rev-parse --short HEAD)
bump:
	@echo "Bumping version to $(VERSION) recursively..."

	@sed -i 's/"version": "[0-9]\+\.[0-9]\+\.[0-9]\+\.[0-9]\+"/"version": "$(VERSION)"/' package.json
	@find public.template -name "swagger.json" -exec sed -i 's/"version": "[0-9]\+\.[0-9]\+\.[0-9]\+\.[0-9]\+"/"version": "$(VERSION)"/' {} \;
	@find src/public -name "swagger.json" -exec sed -i 's/"version": "[0-9]\+\.[0-9]\+\.[0-9]\+\.[0-9]\+"/"version": "$(VERSION)"/' {} \;
build: bump
	@npm run build
initdocker:
	@docker buildx create --name openiap --use
	@docker buildx inspect --bootstrap
load:
	@docker buildx build -t openiap/openflow:$(VERSION) -t openiap/openflow:$(HASH) -t openiap/openflow:edge --platform linux/amd64 --load .
compose-no-cache: bump
	@docker buildx build --no-cache -t openiap/openflow:$(VERSION) -t openiap/openflow:$(HASH) -t openiap/openflow:edge --platform linux/amd64 --push .
compose: bump
	@docker buildx build -t openiap/openflow:$(VERSION) -t openiap/openflow:$(HASH) -t openiap/openflow:edge --platform linux/amd64 --push .
publish: bump
	@docker buildx build -t openiap/openflow:$(VERSION) -t openiap/openflow:$(HASH) -t openiap/openflow:latest --platform linux/amd64,linux/arm64,linux/arm/v7 --push .
copypublic: bump
	@rm -rf public && cp -r ../core-web/build/ public
copypublicold: bump
	@rm -rf public && cp -r ../openflow-web/dist/ public
linkpublicold: bump
	@rm -rf public && ln -s /mnt/data/vscode/config/workspace/code/openflow-web/dist /mnt/data/vscode/config/workspace/code/openflow/public
