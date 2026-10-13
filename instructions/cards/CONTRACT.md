# Контракт сайта и обработчика

Дополнение к действующему `avitolog.mailbox.v1`, версия блока cards — 2. Существующие объявления без новых полей читаются: `realistic`, количество 1, формат auto. Не переименовывать историческое значение realistic в home в JSON.

## Движение

```text
Форма: стиль + число + формат + фото + заметки
  → локальное сохранение → inbox/*-text.txt и его вложения
  → локальный обработчик: получить cards.requested, захватить событие
  → facts.json / shot-plan.json / генерация / проверка
  → outbox/<время>-<requestId>-01.png ...
  → outbox/<время>-<requestId>-result.json с cards.completed
  → сайт при синхронизации показывает готовые фото
```

Вложение загружается раньше манифеста задания; изображения результата — раньше результата. На промежуточном сбое итоговый манифест не публикуется. Пути вложений в JSON относительно inbox или outbox, без `..`, URL, дисков и абсолютных путей. Ключи доступа в файлы не включать.

## Вход

Событие `cards.requested`: `id` — идентификатор события, `payload.requestId` — запрос, `payload.itemId`, `payload.item` — снимок объявления; `payload.photoIds`, `payload.requestKey`, `payload.style`, `payload.count`, `payload.format`, `payload.aspectRatio`. `markers.action=cards.generate`, `markers.cards` дублирует параметры. Если блоки расходятся — ошибка контракта, не угадывать.

`markers.cards`: `contractVersion:2`, `requested:true`, `style:realistic|studio|designer`, `count:1..10`, `format:auto|landscape|portrait`, `aspectRatio:null|4:3|3:4`, `uniformAspectRatio:true`, `baseStyle:studio` только для designer, `preserveProduct:true`, `factsSource:listing.description-and-notes`, `guide:instructions/cards/README.md`.

Отдельное `item.created`/`item.edited` сохраняет объявление. Если вместе приходит cards.requested, не генерировать дважды по двум событиям. Генерацию запускает cards.requested; флаг в снимке — намерение и состояние UI.

`requestKey` — непрозрачная строка, которую сайт строит из настроек, описания, цены, состояния и идентификаторов исходников. Копировать буквально, не пересчитывать алгоритмом другой версии. Локально можно хешировать её для имени папки. Смена фото/текста/стиля/количества/формата создаёт другое задание. Повторное сохранение без изменений — не новое задание.

## Ответ

```json
{
 "schema":"avitolog.mailbox.v1",
 "id":"unique-result-id",
 "type":"cards.completed",
 "createdAt":"2026-10-13T10:00:00Z",
 "sourceEventId":"original-event-id",
 "payload":{
   "itemId":"listing-id",
   "requestId":"original-request-id",
   "requestKey":"EXACT_INPUT_STRING",
   "style":"designer",
   "aspectRatio":"4:3",
   "photos":[
     {"id":"unique-photo-id","name":"Общий вид","file":"20261013100000-request-01.png","type":"image/png","width":1600,"height":1200}
   ]
 }
}
```

Число photos равно запрошенному count, порядок задаёт сюжет. Все изображения одной пропорции; размер считать по самому файлу, не по желаемому промпту. Имена уникальны; старые результаты не перезаписывать. До доставки обработчик сохраняет локальную запись с sourceEventId/requestId/requestKey и SHA-256 файлов. При повторе API сверяет уже отправленные имена и хеши.

Сайт принимает результат только для текущего requestKey, стиля, количества и формата. Исходники сохраняются отдельно в sourcePhotos; карточки становятся галереей. `cards.completed` не переводит объявление в опубликованные и не меняет цену. Подготовка текста объявления возвращается существующим `listing.ready` отдельно.

Ошибки: `needs_input` при отсутствии исходника/фактов, `quality_failed` при изменении товара, `retryable_error` при сети, `quota_exhausted` при лимите. Их регистрирует обработчик в своём журнале; не выдавать cards.completed для неполной серии. После лимита не гонять бесконечные повторы. Если картинка создана, но CLI не вернул JSON, сначала сверить артефакты именно того сеанса, затем решать о повторе.

Готовый сервер-обработчик этой инструкцией не устанавливается: пакет задаёт интерфейс для его реализации. Сайт передаёт задания через уже существующую очередь GitHub; компьютер может скачать их обычным Contents API с правом чтения, а результат отправить с правом записи.
