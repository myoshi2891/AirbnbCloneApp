# 定数定義
DOCKER_IMAGE_NAME = home-away-nextjs-app
# DOCKER_CONTAINER_NAME = home-away-nextjs-container
PORT = 3000

# デフォルトのターゲット
all: build

# Docker イメージのビルド
build:
	docker build -t $(DOCKER_IMAGE_NAME) .

# Docker コンテナの起動 (開発モード)
dev:
	docker run --rm -it -p $(PORT):3000 -v $(PWD):/app -w /app $(DOCKER_IMAGE_NAME) npm run dev

# Docker コンテナの起動 (本番モード)
start:
	docker run --rm -d -p $(PORT):3000 --name $(DOCKER_CONTAINER_NAME) $(DOCKER_IMAGE_NAME)

# Docker コンテナの停止
stop:
	docker stop $(DOCKER_CONTAINER_NAME) || true

# Docker コンテナとイメージのクリーンアップ
clean:
	docker rm -f $(DOCKER_CONTAINER_NAME) || true
	docker rmi -f $(DOCKER_IMAGE_NAME) || true

# Next.js のキャッシュクリア
clear-cache:
	docker run --rm -it -v $(PWD):/app -w /app $(DOCKER_IMAGE_NAME) npm run clean

# ローカル環境でテストの実行
test:
	docker run --rm -it -v $(PWD):/app -w /app $(DOCKER_IMAGE_NAME) npm test
