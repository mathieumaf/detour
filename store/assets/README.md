# Store visuals — source & regeneration

The store images are generated from the HTML templates in this folder, so they
stay editable and reproducible across versions. Edit the HTML/CSS here, re-render
to PNG, and drop the results into `store/chrome/` and `store/firefox/`.

## Files

- `listing.css` — shared theme + popup/settings mockups (mirrors the real
  extension UI). Edit here to restyle every asset at once.
- `nodes.svg` — the background routing motif.
- `marquee-1400x560.html` — Chrome "marquee" promo (1400×560).
- `tile-440x280.html` — Chrome "small promo tile" (440×280).
- `screenshot-1-popup-1280x800.html` — popup screenshot.
- `screenshot-2-settings-1280x800.html` — settings page screenshot.
- `screenshot-3-features-1280x800.html` — feature grid screenshot.

Screenshots are 1280×800 (Chrome's required size; AMO accepts any size, so the
same files are reused for Firefox).

## Outputs

- `store/chrome/` — marquee, small tile, and three screenshots.
- `store/firefox/` — the three screenshots (AMO has no promo tiles; the icon is
  set directly in the AMO dashboard).

All PNGs are exported opaque (no alpha) to satisfy the Chrome Web Store's
"24-bit PNG, no alpha" requirement.

## Regenerate

Renders at 2× for crisp text, then downscales to the exact store dimensions.
macOS, with Google Chrome installed:

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd store/assets

render() { # html width height outfile
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --user-data-dir=/tmp/detour-shot --force-device-scale-factor=2 \
    --virtual-time-budget=2500 --default-background-color=ffffffff \
    --window-size=$2,$3 --screenshot="$4" "file://$PWD/$1" &
  pid=$!; for i in $(seq 1 20); do [ -s "$4" ] && break; sleep 1; done
  sleep 1; kill $pid 2>/dev/null
  sips -z $3 $2 "$4" >/dev/null   # sips order is: -z height width
}

render marquee-1400x560.html             1400 560  ../chrome/marquee-1400x560.png
render tile-440x280.html                 440  280  ../chrome/promo-small-440x280.png
render screenshot-1-popup-1280x800.html  1280 800  ../chrome/screenshot-1-popup-1280x800.png
render screenshot-2-settings-1280x800.html 1280 800 ../chrome/screenshot-2-settings-1280x800.png
render screenshot-3-features-1280x800.html 1280 800 ../chrome/screenshot-3-features-1280x800.png
cp ../chrome/screenshot-*.png ../firefox/
```

Note: headless Chrome writes the PNG and then sometimes fails to exit, so the
snippet waits for the file and kills the process.
