# RNBO-Dynamic-WebUI

## Overview
A small Flask web UI for the Cycling '74 RNBO runner (e.g. on a Raspberry Pi). The page reads the
runner's OSCQuery JSON (`http://<runner>:5678/`) in the browser and builds one card per patcher
instance, with no per-patch configuration:

- **Controls** for every parameter, message inport and data ref (buffer). Values are sent to the
  runner over OSC (UDP 1234) through the Flask app.
- **Sound files**: each buffer (data ref) gets a picker listing the files in the runner's datafile
  directory (`~/Documents/rnbo/datafiles`, where the runner panel uploads to). The Flask endpoint
  `/api/datafiles` asks the runner for the listing (JSON-RPC `file_read` with `filetype: datafile`
  sent to `/rnbo/cmd`, reply read from `/rnbo/resp`) and caches it until
  `/rnbo/info/datafile_dir_mtime` changes, so uploads appear on the next hover/touch of the picker or
  within 10 s. After you pick a file, the page reads the buffer back to confirm the runner loaded it.
- **Routing**: each card shows where its audio comes from and goes to, read from the instance's JACK
  connections (`/rnbo/inst/N/jack/connections/audio/{sinks,sources}`). `system:capture_*` is shown
  as **Mic in**, `system:playback_*` as **Output** and `rnbo-record` as **Recorder**. Click an
  instance chip to jump to its card.
- **Responsive layout**: a multi-column grid on wide screens, a single column with larger touch
  targets on phones (< 600 px).

## Control metadata (`@meta`)
RNBO's `[param]` and `[inport]` objects (and buffers/data refs) take a `@meta` attribute. The runner
exposes it at `.../params/<name>/meta` and `.../messages/in/<name>/meta`, and the web UI reads it as
JSON to decide how each control looks. Comments in the patch are not exported, so `@meta` is the way
to give controls a label and type.

In Max, set it on the object, e.g. in the inspector or in the box:

```
[inport in1 @meta {"label":"Play","ui":"button"}]
[inport in2 @meta {"label":"Stop","ui":"button"}]
[inport in3 @meta {"label":"Loop","ui":"toggle"}]
[param playrate @min -4 @max 4 @meta {"label":"Speed","order":1}]
```

Then re-export to the runner. To check what arrived, open
`http://<runner>:5678/rnbo/inst/<N>/messages/in/<name>/meta` (or `.../params/<name>/meta`): the
`VALUE` must be valid JSON with double-quoted keys. If Max has stripped the quotes when typed into
the object box, set the attribute in the inspector instead.

| Key     | Applies to            | Meaning |
|---------|-----------------------|---------|
| `label` | all                   | Text shown on the control. Default: the param's display name, else its name. |
| `ui`    | all                   | `button`, `toggle`, `slider`, `text`, `menu` (enum params) or `hidden`. |
| `value` | button, toggle, text  | Value a button sends / a toggle sends when on / text box default. Default `1` (params: the max). |
| `min`, `max`, `step` | slider | Slider range. Params default to their RNBO range; inports default to 0–1. |
| `order` | all                   | Number; lower comes first in the card. Controls without it follow, params before inports before buffers. |

Control types:

- **button**: momentary; sends `value` once per press. Consecutive buttons share a row (e.g. Play | Stop).
- **toggle**: sends `value` (default 1) when switched on and `0` when off. Inports have no readable
  state in the runner, so an inport toggle remembers its last position in the browser (localStorage).
- **slider**: continuous value.
- **text**: a text box and a Send button (sends whatever you type).
- **hidden**: not shown.

Defaults when `@meta` is empty or not valid JSON:

- Float params → slider. Enum params with values `0`/`1` → toggle. Other enum params → menu.
- Inports are guessed from their name: words `play`, `start`, `stop`, `trigger`, `trig`, `bang`,
  `reset` → button; `loop`, `mute`, `on`, `enable` → toggle; anything else (e.g. `in1`) → text box + Send.

The `meta` value is also writable on the runner at runtime (via OSC/OSCQuery), but that is not saved
with the patch; setting `@meta` in Max is the durable way.

## Installation
1. Clone the repository:
    ```sh
    git clone https://github.com/PupBrutus/RNBO-Dynamic-WebUI.git
    ```
2. Navigate to the project directory:
    ```sh
    cd RNBO-Dynamic-WebUI
    ```
3. Install the required dependencies:
    ```sh
    pip install -r requirements.txt
    ```

## Usage
On the machine running the RNBO runner:
```sh
python app.py
```
Then open `http://<host>:8080/`.

To develop on another machine against a remote runner, point the app at it (and optionally change
the port):
```sh
RNBO_HOST=192.168.1.104 PORT=8091 python app.py
```
The runner's OSCQuery server allows cross-origin requests, so the browser can read it directly.

## License
This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International License. To view a copy of this license, visit [https://creativecommons.org/licenses/by-nc/4.0/](https://creativecommons.org/licenses/by-nc/4.0/).
