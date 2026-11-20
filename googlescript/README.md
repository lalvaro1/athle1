# Scripts Google Apps Script (athle.fr → R2)

Ces fichiers alimentent le site (planning club, base athlètes) en récupérant les données sur [athle.fr](https://www.athle.fr) et en les écrivant dans le bucket Cloudflare R2 (`data/…`).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `Config.gs` | Club, filtres U14/U16, pause HTTP, infos R2 (sans secrets) |
| `Athlelib.gs` | Scraping athle.fr (calendrier, résultats, Live/start-lists, bilans, fiches) |
| `R2SSStorage.gss` | Upload / download JSON vers R2 (token en Script Properties) |
| `Main.gs` | Points d’entrée à lancer depuis l’éditeur Apps Script |

À coller tels quels dans un projet Apps Script (même ordre / mêmes noms).

## Première config (une fois)

1. Renseigner `ATHLE_CONFIG` dans `Config.gs` (club, département, catégories).
2. Exécuter **`setR2ApiTokenFromEditor`** (dans `R2SSStorage.gss`) pour enregistrer le token R2.
3. Optionnel : exécuter **`installHourlyTrigger`** pour lancer `syncAthleHourly` toutes les heures.

## Que lancer maintenant ?

Pour le Critérium de demain (start-lists Live + PDF horaires) :

→ **`runAthleSyncForTodayAndTomorrow`**

Ça synchronise **aujourd’hui et demain** : compétitions avec résultats, et compétitions à venir (fiche, PDF, Live → planning club).

## Points d’entrée utiles

### Compétitions / planning

| Fonction | Quand l’utiliser |
| --- | --- |
| **`runAthleSyncForTodayAndTomorrow`** | Sync manuelle courante (J + J+1). C’est aussi ce que fait le trigger horaire. |
| `runAthleSyncForToday` | Seulement la date du jour. |
| `syncAthleHourly` | Entrée du déclencheur horaire (ne pas lancer à la main sauf test). |
| `getAllDataForMonth(mois, année)` | Backfill d’un mois entier. |
| `runGetAllDataForMonth` | Raccourci éditeur (mois/année en dur dans le code). |
| `rebuildCompetitionsIndexFromBucket` | Reconstruit `data/competitions.json` à partir des JSON déjà sur R2. |

### Athlètes

| Fonction | Quand l’utiliser |
| --- | --- |
| `runAthleSyncAthletes` | Index compact `data/athletes.json` (bilans U14/U16). |
| `runAthleSyncAthleteDetails` | Fiches complètes `data/athletes/{id}.json` + maj de l’index. |
| `runAthleSyncAthleteDetailOne` | Une seule fiche (debug / test). |

### Stockage

| Fonction | Quand l’utiliser |
| --- | --- |
| `setR2ApiTokenFromEditor` | Enregistrer / renouveler le token API R2. |
| `testR2Upload` | Vérifier l’accès écriture au bucket. |

## Ce que produit une sync compétitions

Pour chaque date :

1. Lit le calendrier athle.fr (jeunes + club local).
2. **Résultats publiés** → détail club (épreuves, horaires, athlètes) → `data/YYYY-MM-DD_….json`.
3. **À venir** → méta fiche (URL, PDF horaires, lien Live) dans `competitions.json`.
4. Si des **start-lists Live** existent → même format de planning club que pour les résultats (source `live-startlists`).
5. Met à jour **`data/competitions.json`** (index lu par le front).

## Logs

Dans l’éditeur Apps Script : **Exécutions** → ouvrir la run → journal. Chercher des lignes du type :

- `à venir … (live 324680, PDF OK)`
- `→ data/….json (N épreuves)`
