BUN  := $(HOME)/.bun/bin/bun
PNPM := $(shell which pnpm)

.PHONY: dev stop install build

dev:
	@trap 'kill 0' INT TERM; \
	(cd packages/api && $(BUN) --watch src/index.ts) & \
	(cd packages/web && $(BUN)x --bun vite --port 3000) & \
	wait

stop:
	-kill $$(lsof -ti:4080,3000) 2>/dev/null

install:
	$(PNPM) install

build:
	$(PNPM) --filter './packages/*' run build
