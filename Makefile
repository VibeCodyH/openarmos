.PHONY: up up-faces up-remote logs down

up:
	docker compose up -d

up-faces:
	docker compose --profile faces up -d

up-remote:
	docker compose --profile remote up -d

logs:
	docker compose --profile faces --profile remote logs -f --tail=200

down:
	docker compose --profile faces --profile remote down
