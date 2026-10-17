# Google Apps Script — sync athle.fr → Cloudflare R2

## Authentification R2 (simple)

Le script envoie les fichiers via l’API REST :

`PUT https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/r2/buckets/<bucket>/objects/<fichier>`

avec **`Authorization: Bearer <token>`**.

### Quel token ?

| Source | Utilisable ici ? |
|--------|------------------|
| **My Profile → API Tokens** (permission **Account → R2 → Edit**) | Oui |
| **R2 → Manage R2 API Tokens** (Access Key + Secret) | Non (S3 uniquement) |

Si vous avez une erreur **403 Authentication error**, vous avez presque toujours le mauvais type de token ou un token **Read only**.

### Configuration

1. `Config.gs` : **ACCOUNT_ID**, **BUCKET** : `athle`
2. Créer un token API (R2 Edit sur votre compte)
3. **`setR2ApiTokenFromEditor()`** : coller le token → enregistrer dans Script Properties (`R2_API_TOKEN`)
4. Supprimer `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` des Script Properties si présents (ancien mode S3)

## Lancement

- **`testR2Upload`** — test minimal
- **`runAthleSyncForToday`** — autoriser UrlFetch (`athle.fr`, `api.cloudflare.com`)
- **`installHourlyTrigger`**
