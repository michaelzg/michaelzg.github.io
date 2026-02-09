# Life In Weeks - Data Format

Edit `life-in-weeks.yml` to customize the timeline.

## Configuration

```yaml
birthday: "1993-03-15"     # Your birthday (YYYY-MM-DD)
lifespan_years: 100         # Total years to display
```

## Events

Add life events to the `events` list, sorted by date:

```yaml
events:
  - date: "2024-01-15"
    label: "🛠️ Side project launched"
    description: "Built and shipped my first open-source tool"
```

### Fields

| Field         | Required | Description                                      |
|---------------|----------|--------------------------------------------------|
| `date`        | Yes      | Event date in `YYYY-MM-DD` format                |
| `label`       | Yes      | Short text shown inside the week box on the grid |
| `description` | No       | Extra detail shown in the hover tooltip          |

### Using Emojis

Paste emojis directly into the `label` field. They render inline with the text:

```yaml
- label: "🎓 Graduated college"
- label: "🚀 New job"
- label: "✈️ Traveled abroad"
```

Some handy emojis for life events:

- Milestones: 🎓 🏆 ⭐ 🎯 📈
- Work: 💼 🚀 🛠️ 💻 📝 🔍 🗺️
- Life: 👶 💍 🏠 🚗 ✈️
- Feelings: 🎉 😷 ❤️ 🌟 🎂

### Descriptions

The `description` field is optional. When present, it appears below the label in the hover tooltip, separated by a line. Use it for context you want to remember but that's too long for the grid label:

```yaml
- date: "2020-03-15"
  label: "😷 Pandemic"
  description: "The world changed overnight"
```

## Decades

The `decades` array controls the color bands (one per decade of life). Each entry has:

```yaml
- label: "Childhood"    # Legend text
  fill: "#FFF8E1"       # Background color (hex)
  border: "#F0D88A"     # Border color (hex)
```

## Auto-generated Events

Birthday events are generated automatically for each year of life - no need to add them manually.
