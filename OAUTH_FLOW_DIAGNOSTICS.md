# OAuth Flow Diagnostic Guide / Руководство по диагностике OAuth

## Проблема: "Connected" но токен не выдан
## Problem: Shows "Connected" but no access token issued

---

## Scenario 1: Incomplete OAuth Flow / Неполный OAuth-процесс

### Symptoms / Симптомы:
- UI shows "Connected" / Интерфейс показывает "Connected"
- No tools visible / Инструменты не видны
- 500 error on callback / Ошибка 500 при callback

### Possible Causes / Возможные причины:

**A. User closed authorization page prematurely**
**Пользователь закрыл страницу авторизации преждевременно**

```
User → my.neonpanel.com/oauth2/authorize
     ↓ [User closes window here / Закрыл окно здесь]
     ✗ No authorization code issued / Код не выдан
     ✗ ChatGPT never gets code / ChatGPT не получает код
```

**How to verify / Как проверить:**
```bash
# Check my.neonpanel.com logs for incomplete authorization
grep "oauth2/authorize" storage/logs/laravel.log | grep -v "200"
```

**B. Redirect didn't complete**
**Редирект не завершился**

```
my.neonpanel.com → redirect to ChatGPT with code
                ↓ [Network issue / Проблема сети]
                ✗ ChatGPT never receives redirect / ChatGPT не получает редирект
```

**How to verify / Как проверить:**
```bash
# Check for successful authorization but no token exchange
grep "oauth2/authorize" storage/logs/laravel.log | tail -10
grep "oauth2/token" storage/logs/laravel.log | tail -10

# Should see authorize request followed by token request
# Должен быть запрос authorize, затем запрос token
```

**Fix / Решение:**
- Complete the full OAuth flow / Завершите полный OAuth-процесс
- Don't close authorization window / Не закрывайте окно авторизации
- Wait for automatic redirect / Дождитесь автоматического редиректа

---

## Scenario 2: Parameter Mismatch / Несоответствие параметров

### Symptoms / Симптомы:
- Authorization succeeds / Авторизация успешна
- Token exchange fails with 400/401 / Обмен токена не работает 400/401
- Error: `invalid_grant` or `invalid_request`

### Critical Parameters / Критические параметры:

**A. client_id mismatch**
**Несоответствие client_id**

Authorization request / Запрос авторизации:
```
https://my.neonpanel.com/oauth2/authorize?
  client_id=chatgpt-client-123
  ...
```

Token exchange / Обмен токена:
```
POST /oauth2/token
client_id=chatgpt-client-456  ← ❌ DIFFERENT / РАЗНЫЙ
```

**How to verify / Как проверить:**
```bash
# Check registered OAuth clients
# Проверьте зарегистрированные OAuth клиенты
mysql -e "SELECT id, name, secret FROM oauth_clients WHERE name LIKE '%chatgpt%'"

# Or in Laravel logs:
grep "client_id" storage/logs/laravel.log | tail -20
```

**B. redirect_uri mismatch**
**Несоответствие redirect_uri**

This is the MOST COMMON issue / Это САМАЯ ЧАСТАЯ проблема:

Authorization:
```
redirect_uri=https://chatgpt.com/backend-api/aip/connectors/oauth/callback
```

Token exchange:
```
redirect_uri=https://chatgpt.com/backend-api/aip/connectors/oauth/callback/  ← ❌ Extra slash!
```

**How to verify / Как проверить:**
```bash
# Compare redirect_uri in logs
# Сравните redirect_uri в логах
grep "redirect_uri" storage/logs/laravel.log | tail -10

# Check registered redirect URIs for client
# Проверьте зарегистрированные redirect URI для клиента
mysql -e "SELECT client_id, redirect FROM oauth_clients"
```

**Fix / Решение:**
- Ensure EXACT match including: / Убедитесь в ТОЧНОМ совпадении включая:
  - Protocol (http vs https)
  - Domain
  - Path
  - Trailing slash / or not
  - Port number (if any)

**C. code_challenge / code_verifier mismatch (PKCE)**
**Несоответствие code_challenge / code_verifier (PKCE)**

Authorization:
```
code_challenge=abc123xyz...
code_challenge_method=S256
```

Token exchange:
```
code_verifier=wrong-verifier  ← ❌ Doesn't match!
```

**How to verify / Как проверить:**
```bash
# Look for PKCE errors in logs
# Ищите ошибки PKCE в логах
grep -i "pkce\|code_challenge\|code_verifier" storage/logs/laravel.log | tail -20
```

**Expected / Ожидается:**
```
SHA256(code_verifier) === code_challenge
```

---

## Scenario 3: Expired or Invalid Code / Истёкший или недействительный код

### Symptoms / Симптомы:
- Error: `invalid_grant`
- Error: `authorization_code has been used`
- Error: `authorization_code has expired`

### A. Code Expired / Код истёк

Authorization codes typically expire in **60 seconds** / 
Коды авторизации обычно истекают через **60 секунд**

```
10:00:00 - Code issued / Код выдан
10:00:58 - Token exchange attempt / Попытка обмена токена ✅
10:01:05 - Token exchange attempt / Попытка обмена токена ❌ EXPIRED / ИСТЁК
```

**How to verify / Как проверить:**
```bash
# Check timestamps in logs
# Проверьте временные метки в логах
grep "authorization_code" storage/logs/laravel.log | tail -20

# Calculate time between authorize and token requests
# Вычислите время между запросами authorize и token
```

**Fix / Решение:**
- Complete OAuth flow faster / Завершайте OAuth-процесс быстрее
- Check for network delays / Проверьте задержки сети
- Increase code lifetime (server config) / Увеличьте время жизни кода (конфиг сервера)

### B. Code Already Used / Код уже использован

OAuth authorization codes are **single-use** / 
OAuth коды авторизации **одноразовые**

```
10:00:00 - Code: abc123 issued / Код выдан
10:00:10 - Token exchange with abc123 ✅ SUCCESS / УСПЕХ
10:00:15 - Token exchange with abc123 ❌ ALREADY USED / УЖЕ ИСПОЛЬЗОВАН
```

**How to verify / Как проверить:**
```bash
# Look for duplicate code usage
# Ищите повторное использование кода
grep "oauth2/token" storage/logs/laravel.log | \
  grep -o "code=[^&]*" | \
  sort | uniq -c | \
  grep -v "^ *1 "
```

**Fix / Решение:**
- Don't retry token exchange / Не повторяйте обмен токена
- If retry needed, start OAuth flow from beginning / Если нужен повтор, начните OAuth с начала

---

## Scenario 4: Scope Issues / Проблемы с разрешениями (scopes)

### Symptoms / Симптомы:
- Error: `invalid_scope`
- Error: `insufficient_scope`
- Token issued but tools not accessible / Токен выдан но инструменты недоступны

### A. Requested Scope Not Allowed / Запрашиваемая область не разрешена

ChatGPT requests / ChatGPT запрашивает:
```
scope=read:data write:data admin:all
```

Server allows / Сервер разрешает:
```
allowed_scopes = ['dcr.create']  ← ❌ MISMATCH / НЕСООТВЕТСТВИЕ
```

**How to verify / Как проверить:**
```bash
# Check allowed scopes for client
# Проверьте разрешённые области для клиента
mysql -e "SELECT client_id, allowed_scopes FROM oauth_clients"

# Check scope validation in logs
# Проверьте валидацию областей в логах
grep -i "scope" storage/logs/laravel.log | tail -20
```

**Fix / Решение:**
- Update allowed scopes for ChatGPT client / Обновите разрешённые области для клиента ChatGPT
- Match requested scopes with what server supports / Сопоставьте запрашиваемые области с тем, что поддерживает сервер

### B. User Denied Scope / Пользователь отклонил область

```
Authorization page shows:
"ChatGPT requests access to: read:data, write:data"

User clicks "Deny write:data" ← Partially denies
```

**How to verify / Как проверить:**
```bash
# Check authorization log for denied scopes
# Проверьте лог авторизации на отклонённые области
grep "authorization.*denied\|scope.*denied" storage/logs/laravel.log
```

**Fix / Решение:**
- Ensure all required scopes are approved / Убедитесь, что все необходимые области одобрены
- Reduce requested scopes to minimum required / Уменьшите запрашиваемые области до минимума

---

## Complete Diagnostic Workflow / Полный процесс диагностики

### Step 1: Check Authorization Flow / Проверьте процесс авторизации

```bash
cd /path/to/my.neonpanel.com

# Watch logs in real-time while testing
# Наблюдайте за логами в реальном времени при тестировании
tail -f storage/logs/laravel.log | grep -i oauth
```

### Step 2: Identify Which Stage Failed / Определите, на каком этапе сбой

```bash
# Check each stage:
# Проверьте каждый этап:

# 1. Authorization request received?
grep "oauth2/authorize" storage/logs/laravel.log | tail -5

# 2. User approved?
grep "authorization.*approved\|user.*consent" storage/logs/laravel.log | tail -5

# 3. Redirect issued?
grep "redirect.*chatgpt\|callback" storage/logs/laravel.log | tail -5

# 4. Token exchange attempted?
grep "oauth2/token" storage/logs/laravel.log | tail -5

# 5. Token issued?
grep "access_token.*issued\|token.*generated" storage/logs/laravel.log | tail -5
```

### Step 3: Extract Specific Error / Извлеките конкретную ошибку

```bash
# Get last OAuth error
# Получите последнюю ошибку OAuth
grep -i "oauth.*error\|oauth.*exception" storage/logs/laravel.log | tail -1

# Common error codes:
# Обычные коды ошибок:
# - invalid_request: Missing required parameter
# - invalid_client: Client authentication failed  
# - invalid_grant: Invalid authorization code
# - unauthorized_client: Client not authorized
# - unsupported_grant_type: Grant type not supported
# - invalid_scope: Invalid scope requested
```

### Step 4: Verify Token Format / Проверьте формат токена

If token exchange succeeds (200) but ChatGPT still fails:
Если обмен токена успешен (200), но ChatGPT всё равно падает:

```bash
# Extract a token from logs
# Извлеките токен из логов
TOKEN=$(grep "access_token" storage/logs/laravel.log | tail -1 | grep -o "eyJ[^\"]*")

# Decode token to check claims
# Декодируйте токен для проверки claims
echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null | jq .

# Expected claims / Ожидаемые claims:
# {
#   "iss": "https://my.neonpanel.com",
#   "sub": "user-id",
#   "aud": "client-id or audience",
#   "exp": 1234567890,
#   "iat": 1234567890,
#   "scope": "dcr.create"
# }
```

---

## Quick Fix Checklist / Быстрый чек-лист исправлений

### ☑️ Before Testing / Перед тестированием

```bash
# 1. Clear OAuth session data
# Очистите данные сессии OAuth
rm -rf storage/framework/sessions/*
php artisan cache:clear

# 2. Verify client configuration
# Проверьте конфигурацию клиента
php artisan passport:client --list  # If using Laravel Passport

# 3. Test token endpoint manually
# Протестируйте token endpoint вручную
curl -X POST https://my.neonpanel.com/oauth2/token \
  -d "grant_type=client_credentials" \
  -d "client_id=test-client" \
  -d "client_secret=test-secret"
```

### ☑️ During Testing / Во время тестирования

1. ✅ Watch logs in real-time / Наблюдайте логи в реальном времени
2. ✅ Don't close authorization window / Не закрывайте окно авторизации
3. ✅ Complete flow within 60 seconds / Завершите процесс за 60 секунд
4. ✅ Approve all requested scopes / Одобрите все запрашиваемые области

### ☑️ After Failure / После сбоя

```bash
# Extract error details
# Извлеките детали ошибки
grep -A 10 "oauth2/token" storage/logs/laravel.log | tail -20

# Check for specific errors:
# Проверьте конкретные ошибки:
grep -i "redirect_uri\|client_id\|code_verifier\|expired\|invalid" \
  storage/logs/laravel.log | tail -10
```

---

## Summary / Резюме

| Issue / Проблема | Error / Ошибка | Solution / Решение |
|------------------|----------------|-------------------|
| Incomplete flow / Неполный процесс | No token exchange in logs | Complete full OAuth flow |
| client_id mismatch | `invalid_client` | Use same client_id in both requests |
| redirect_uri mismatch | `invalid_grant` | Ensure EXACT match including slash |
| PKCE mismatch | `invalid_request` | Verify SHA256(verifier) == challenge |
| Code expired | `invalid_grant` | Complete flow faster (<60s) |
| Code reused | `invalid_grant` | Start new OAuth flow |
| Scope not allowed | `invalid_scope` | Update client allowed scopes |
| Scope denied | Token has limited scopes | Approve all required scopes |

---

## Next Steps / Следующие шаги

1. **SSH into my.neonpanel.com** and run:
   ```bash
   tail -f storage/logs/laravel.log | grep -i oauth
   ```

2. **Try OAuth flow in ChatGPT** while watching logs

3. **Identify exact error** from the patterns above

4. **Apply corresponding fix** from checklist

5. **Retry OAuth connection**

---

Good luck! / Удачи! 🚀
