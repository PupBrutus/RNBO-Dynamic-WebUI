from flask import Flask, jsonify, render_template, request
from jinja2 import TemplateNotFound
from pythonosc.udp_client import SimpleUDPClient
import json
import os
import socket
import threading
import time
import urllib.request
import uuid

app = Flask(__name__, template_folder='templates', static_folder='static')


def detect_server():
    """Return the RNBO runner host.

    Set the RNBO_HOST environment variable to point at a runner on another
    machine (e.g. when developing on a laptop against the Pi). Otherwise the
    local IP is used, which is correct when this app runs on the Pi itself.
    """
    override = os.environ.get('RNBO_HOST')
    if override:
        return override
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        s.connect(('10.254.254.254', 1))  # Dummy IP address to get the local IP
        server = s.getsockname()[0]
        s.close()
        return server
    except Exception as e:
        print(f"Failed to get external IP address: {e}")
        return '127.0.0.1'


def to_osc_value(value):
    """Send numbers (including negatives) as floats, anything else as a string."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return value


OSC_PORT = 1234
QUERY_PORT = 5678

# Datafile listing cache, keyed on the runner's datafile_dir_mtime so uploads
# and deletions made in the runner panel show up on the next request.
_datafiles_lock = threading.Lock()
_datafiles_cache = {'mtime': None, 'files': []}


def query_value(server, path):
    """Read one OSCQuery node's VALUE from the runner."""
    with urllib.request.urlopen(f'http://{server}:{QUERY_PORT}{path}', timeout=2) as res:
        return json.load(res).get('VALUE')


def list_datafiles(server, timeout=3.0):
    """Ask the runner for the files in its datafile directory.

    The runner answers JSON-RPC commands sent to /rnbo/cmd by writing the reply
    to /rnbo/resp. `file_read` with filetype "datafile" and no filename returns
    the directory listing as a JSON array of paths in result.content.
    """
    request_id = str(uuid.uuid4())
    command = {
        'jsonrpc': '2.0',
        'id': request_id,
        'method': 'file_read',
        'params': {'filetype': 'datafile', 'size': 1048576},
    }
    SimpleUDPClient(server, OSC_PORT).send_message('/rnbo/cmd', json.dumps(command))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        time.sleep(0.05)
        raw = query_value(server, '/rnbo/resp')
        try:
            reply = json.loads(raw) if raw else {}
        except ValueError:
            continue
        if reply.get('id') != request_id:
            continue
        if 'error' in reply:
            raise RuntimeError(reply['error'].get('message', 'runner error'))
        paths = json.loads(reply['result']['content'])
        return sorted((p.rsplit('/', 1)[-1] for p in paths), key=str.lower)
    raise TimeoutError('runner did not answer the datafile listing request')


@app.route('/api/datafiles')
def datafiles():
    server = detect_server()
    with _datafiles_lock:  # one command in flight at a time; /rnbo/resp holds only the last reply
        try:
            mtime = query_value(server, '/rnbo/info/datafile_dir_mtime')
            if mtime is None or mtime != _datafiles_cache['mtime']:
                _datafiles_cache['files'] = list_datafiles(server)
                _datafiles_cache['mtime'] = mtime
            return jsonify(files=_datafiles_cache['files'], mtime=mtime)
        except Exception as e:
            print(f"Failed to list datafiles: {e}")
            return jsonify(error=str(e), files=_datafiles_cache['files']), 502


@app.route('/', methods=['GET', 'POST'])
def index():
    server = detect_server()
    port = str(OSC_PORT)
    data_retrieve_port = str(QUERY_PORT)
    if request.method == 'POST':
        action = request.form.get('action')
        instance_param = request.form.get('instanceParam')
        if action == 'connect':
            try:
                client = SimpleUDPClient(server, int(port))
                for key, value in request.form.items():
                    if key not in ['action', 'instanceParam']:
                        client.send_message(instance_param, to_osc_value(value))
                print(f"Sent {instance_param} to {server}:{port}")
                return '', 204  # No Content response for AJAX request
            except Exception as e:
                print(f"Failed to connect to server: {e}")
                return f"Failed to connect to server: {e}", 500

    try:
        print(f"Rendering template with server: {server}, port: {port}, data_retrieve_port: {data_retrieve_port}")
        return render_template('index.html', server=server, port=port, data_retrieve_port=data_retrieve_port)
    except TemplateNotFound:
        print("Template not found")
        return "Template not found", 404

if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))  # Listen on all network interfaces
