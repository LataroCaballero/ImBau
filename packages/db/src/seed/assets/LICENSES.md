# Seed media assets — procedencia y licencia (D-03)

Imágenes de stock libre curadas para el seed demo-grade del edificio ficticio **"Brigos
Recoleta"**. Son un **stand-in**: el material real de Pablo (Branch B) las reemplaza más
adelante sin re-seed estructural (D-03 / Deferred Ideas). Se commitean en el repo (no se
descargan en build/seed) para determinismo y reproducibilidad (RESEARCH Pattern 5).

Cada archivo se sube a R2 y lo procesa `apps/worker` (sharp) generando variantes AVIF/WebP +
blurhash + dimensiones; el re-encode de sharp además descarta la mayoría de payloads embebidos
(mitigación T-03-05).

## Licencia

Todas las fotos provienen de **Unsplash** (vía [Lorem Picsum](https://picsum.photos), que sirve
fotos de Unsplash) y están bajo la **[Unsplash License](https://unsplash.com/license)** — uso
comercial y no comercial permitido, sin necesidad de permiso ni atribución. Se registra la
autoría igualmente por buena práctica y trazabilidad.

## Assets

| Archivo | Sección | Autor (Unsplash) | Foto original | Fuente | Licencia |
|---------|---------|------------------|---------------|--------|----------|
| `amenities-pileta.jpg` | amenities | Anthony DELANOIX | https://unsplash.com/photos/b5POxb2aL9o | Lorem Picsum id 1048 | Unsplash License |
| `amenities-gym.jpg` | amenities | Linh Nguyen | https://unsplash.com/photos/agkblvPff5U | Lorem Picsum id 164 | Unsplash License |
| `amenities-sum.jpg` | amenities | Sylwia Bartyzel | https://unsplash.com/photos/OdAqbedkfiA | Lorem Picsum id 260 | Unsplash License |
| `amenities-rooftop.jpg` | amenities | Paweł Wojciechowski | https://unsplash.com/photos/QYAojSRu82c | Lorem Picsum id 323 | Unsplash License |
| `exteriores-fachada.jpg` | exteriores | Steven Lewis | https://unsplash.com/photos/r4He4Btlsro | Lorem Picsum id 342 | Unsplash License |
| `exteriores-entrada.jpg` | exteriores | Carli Jean | https://unsplash.com/photos/UWRqlJcDCXA | Lorem Picsum id 431 | Unsplash License |
| `exteriores-balcon.jpg` | exteriores | Matthew Wiebe | https://unsplash.com/photos/VQIbwDaqJKc | Lorem Picsum id 439 | Unsplash License |
| `interiores-living.jpg` | interiores | Desi Mendoza | https://unsplash.com/photos/CuSHBGBdXc0 | Lorem Picsum id 452 | Unsplash License |
| `interiores-cocina.jpg` | interiores | Jeffrey Deng | https://unsplash.com/photos/h6t2dbYgDuc | Lorem Picsum id 493 | Unsplash License |
| `interiores-dormitorio.jpg` | interiores | Matthew Wiebe | https://unsplash.com/photos/v41pwp_RRJU | Lorem Picsum id 494 | Unsplash License |
| `interiores-bano.jpg` | interiores | Erik Heddema | https://unsplash.com/photos/7qheceNIy7k | Lorem Picsum id 522 | Unsplash License |
| `obra-avance-01.jpg` | progress (obra/avance) | Jay Mantri | https://unsplash.com/photos/TFyi0QOx08c | Lorem Picsum id 634 | Unsplash License |
| `obra-avance-02.jpg` | progress (obra/avance) | Maja Petric | https://unsplash.com/photos/vGQ49l9I4EE | Lorem Picsum id 674 | Unsplash License |

_Descargadas a 1600×1067 (~85–350 KB c/u, ~2.5 MB total). El worker regenera todas las
variantes, así que el tamaño de origen sólo necesita ser razonable._
