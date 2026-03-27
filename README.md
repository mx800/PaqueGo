# PaqueGo

Application Blazor WebAssembly PWA pour organiser une chasse aux oeufs de Paques sur mobile.

## Fonctionnalites

- chargement d'un fichier JSON de points GPS
- selection automatique de l'oeuf restant le plus proche
- boussole mobile basee sur GPS + orientation du telephone
- distance approximative jusqu'a l'objectif
- etat froid, tiede, chaud
- validation d'un oeuf trouve pour passer au suivant
- progression memorisee sur le telephone
- interface Radzen tres coloree, animee et adaptee aux enfants
- deploiement automatique sur GitHub Pages

## Format JSON

Le format le plus simple est une liste d'objets :

```json
[
  {
    "name": "Oeuf arc-en-ciel",
    "latitude": 48.8566,
    "longitude": 2.3522,
    "hint": "Pres du grand arbre"
  }
]
```

Proprietes acceptees :

- `name`, `title` ou `label`
- `latitude` ou `lat`
- `longitude`, `lng`, `lon` ou `long`
- `hint` ou `indice`
- `id` en option

## Lancement local

```powershell
dotnet restore .\PaqueGo.App\PaqueGo.App.csproj
dotnet run --project .\PaqueGo.App\PaqueGo.App.csproj
```

## Tests

```powershell
dotnet test .\PaqueGo.App.Tests\PaqueGo.App.Tests.csproj
```

## Playwright MCP en Docker

Le depot contient un `docker-compose.yml` pour lancer un serveur MCP Playwright HTTP en local.

Prerequis :

- Docker Desktop demarre
- l'application Blazor lancee en HTTP sur `http://localhost:5167`

Demarrage de l'application :

```powershell
dotnet run --project .\PaqueGo.App\PaqueGo.App.csproj --launch-profile http
```

Demarrage du serveur MCP Playwright :

```powershell
docker compose up -d
```

Le serveur MCP est alors expose sur :

- `http://localhost:8931/mcp`

La configuration Compose autorise volontairement tous les hotes HTTP vers ce serveur MCP local avec `--allowed-hosts "*"` pour eviter un rejet `403` pendant les tests en local.

Depuis le conteneur Playwright, l'application locale doit etre visee via :

- `http://host.docker.internal:5167`

Un petit fichier de reference est fourni dans `playwright-mcp.config.json` :

```json
{
  "targetUrl": "http://host.docker.internal:5167",
  "mcpUrl": "http://localhost:8931/mcp"
}
```

Arret du serveur MCP :

```powershell
docker compose down
```

Pour repartir d'une session navigateur propre, supprime aussi le volume Docker associe :

```powershell
docker compose down -v
```

## GitHub Pages

Le workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) publie automatiquement l'application sur GitHub Pages apres un push sur `main`.

Pour la meilleure experience plein ecran sur telephone :

- ouvrir la page publiee sur mobile
- ajouter l'application a l'ecran d'accueil
- lancer l'application depuis l'icone installee

Sur iPhone, l'autorisation de la boussole peut demander une action utilisateur au demarrage.