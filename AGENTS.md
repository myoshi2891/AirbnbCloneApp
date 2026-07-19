# Repository agent instructions

## Secret-safe Docker Compose validation

- Compose設定の検証には必ず`bun run compose:check`を使う。
- `.env`の値を出力するため、オプションなしの`docker compose config`を実行しない。
- 検証コマンドは`docker compose config --no-interpolate --quiet`から変更しない。
