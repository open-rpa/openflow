VERSION = 1.5.11.31
HASH = $(shell git rev-parse --short HEAD)
bump:
	@echo "Bumping version to $(VERSION) recursively..."

	@sed -i 's/"version": "[0-9]\+\.[0-9]\+\.[0-9]\+\.[0-9]\+"/"version": "$(VERSION)"/' package.json
	@find public.template -name "swagger.json" -exec sed -i 's/"version": "[0-9]\+\.[0-9]\+\.[0-9]\+\.[0-9]\+"/"version": "$(VERSION)"/' {} \;
	@find src/public -name "swagger.json" -exec sed -i 's/"version": "[0-9]\+\.[0-9]\+\.[0-9]\+\.[0-9]\+"/"version": "$(VERSION)"/' {} \;
build:
	@npm run build
initdocker:
	@docker buildx create --name openiap --use
	@docker buildx inspect --bootstrap
compose:
	@docker buildx build -t openiap/openflow:$(VERSION) -t openiap/openflow:$(HASH) -t openiap/openflow:edge --platform linux/amd64 --push .
publish:
	@docker buildx build -t openiap/openflow:$(VERSION) -t openiap/openflow:$(HASH) -t openiap/openflow:latest --platform linux/amd64,linux/arm64,linux/arm/v7 --push .
copypublic:
	@rm -rf public && cp -r ../core-web/build/ public
copypublicold:
	@rm -rf public && cp -r ../openflow-web/dist/ public
linkpublicold:
	@rm -rf public && ln -s /mnt/data/vscode/config/workspace/code/openflow-web/dist /mnt/data/vscode/config/workspace/code/openflow/public
