from flask import Flask, render_template, request, url_for
from jinja2 import TemplateNotFound
from pythonosc.udp_client import SimpleUDPClient
import requests
import socket

app = Flask(__name__, template_folder='templates', static_folder='static')

@app.route('/', methods=['GET', 'POST'])
def index():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        s.connect(('10.254.254.254', 1))  # Dummy IP address to get the local IP
        server = s.getsockname()[0]
        s.close()
    except Exception as e:
        print(f"Failed to get external IP address: {e}")
        server = '127.0.0.1'
    port = '1234'
    data_retrieve_port = '5678'
    if request.method == 'POST':
        action = request.form.get('action')
        instance_param = request.form.get('instanceParam')
        if action == 'connect':
            try:
                client = SimpleUDPClient(server, int(port))
                for key, value in request.form.items():
                    if key not in ['action', 'instanceParam']:
                        client.send_message(instance_param, float(value) if value.replace('.', '', 1).isdigit() else value)
                print(f"Connected and sent data to {server}:{port}")
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
    app.run(debug=False, host='0.0.0.0', port=8080)  # Listen on all network interfaces