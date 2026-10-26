# Проверка Android-переноса

Дата: 2026-10-26. Рабочая среда: Linux x86_64, `/home/arimi/Work/projects/keeps`.

## Выполнено

- Изучены dashboard, sidebar, create/edit, note-card, trash, tag-input, импорт, Zustand/RxDB, закреплённые заметки, серверные и Supabase-напоминания исходного приложения.
- `python3 tools/test_schema.py`: **8/8 passed**. Используется поставляемый `schema.sql`, включая проверку записи и повторного открытия настоящего SQLite-файла.
- `python3 -m py_compile tools/prepare.py tools/bootstrap_linux.py tools/test_schema.py`: успешно.
- `bash -n tools/build_apk.sh`, `sh -n android/gradlew`: успешно.
- `pubspec.yaml`, `analysis_options.yaml`, GitHub workflow: YAML разобран успешно.
- Все Android XML разобраны успешно; объявленные Activity/Receiver имеют соответствующие исходники.
- Методы Dart MethodChannel сопоставлены с обработчиками Java.
- Launcher PNG совпадают побайтно с иконками исходного web-приложения.
- Лексическая проверка парности скобок в Dart/Java пройдена. Это не компилятор и не анализатор типов.

## Не выполнено из-за окружения

`./tools/build_apk.sh` завершился с:

```text
Missing flutter. Run python3 tools/bootstrap_linux.py (requires internet).
```

Попытка установки `python3 tools/bootstrap_linux.py` завершилась с:

```text
Toolchain setup failed: <urlopen error [Errno -3] Temporary failure in name resolution>
```

Flutter, Dart, Java/JDK, Gradle и Android SDK в среде не найдены. Поэтому **APK не собран**, `flutter analyze`, Flutter widget/unit/integration tests, Android instrumentation tests не запускались. Работоспособность APK и визуальное совпадение на устройстве пока не подтверждены. GitHub Actions workflow создан локально; запуска или загрузки в удалённый репозиторий не было.

Следующий обязательный этап — выполнить сборочный сценарий в среде с SDK и сетью, исправить возможные ошибки компиляции/тестов, затем пройти сценарии Android из README и сравнить экраны с исходным приложением. Наличие исходников и успешные проверки без SDK не заменяют этот этап.

## Исправление загрузчика и подготовка облачной сборки

После сообщения пользователя об HTTP 404 исправлен адрес манифеста Flutter: `https://storage.googleapis.com/flutter_infra_release/releases/releases_linux.json`. В прежнем адресе был лишний сегмент `/flutter/`. Корректный адрес и наличие Flutter 3.32.8 сверены с официальным JSON; SHA-256 архива: `c2c7d75f9be53f10f3fdba2f7e042b2ef0852cc088392b374bcec34c6204ed8c`. Ошибки загрузки теперь содержат HTTP-статус и URL.

Добавлен push-триггер для отдельной ветки `codex/android-apk` и `tools/cloud_apk.sh` для запуска, ожидания и загрузки артефакта. После входа пользователя аккаунт 78dima виден в CLI, но запросы из сессии агента к GitHub по-прежнему завершаются `Could not resolve host: github.com` / `error connecting to api.github.com`. Статус фактического облачного запуска нужно проверять отдельно; подготовка workflow не означает, что APK собран.
