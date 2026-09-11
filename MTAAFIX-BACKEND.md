# MtaaFix KE Backend

The MtaaFix backend is implemented in `server.js` with Express and SQLite.

## Start the backend

```powershell
npm.cmd install
npm.cmd start
```

The server runs at `http://localhost:3000`.

## API endpoints

### Health check

```http
GET /api/health
```

### Get all reports

```http
GET /api/reports
```

Example response:

```json
[
  {
    "id": 1,
    "title": "Streetlight out on River Road",
    "category": "Streetlight",
    "location": "Ngara, Nairobi",
    "severity": "Medium",
    "status": "Unresolved",
    "confirmations": 14,
    "icon": "light",
    "color": "yellow"
  }
]
```

### Create a report

```http
POST /api/reports
Content-Type: application/json
```

Request body:

```json
{
  "category": "Roads",
  "description": "Deep pothole beside the market",
  "location": "Kawangware, Nairobi",
  "photo": "pothole.jpg"
}
```

Required fields are `category`, `description`, and `location`.

### Confirm a report

```http
POST /api/reports/:id/confirm
```

Example:

```http
POST /api/reports/1/confirm
```

Each confirmation increases the report count. A report becomes high priority when it reaches 20 confirmations.

## Frontend connection

The MtaaFix page at `mtaa-fix.html` uses:

- `GET /api/reports` when the page loads
- `POST /api/reports` when a user submits a report
- `POST /api/reports/:id/confirm` when a user confirms a report

The database is stored in `portfolio.sqlite`.
