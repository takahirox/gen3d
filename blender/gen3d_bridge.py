"""Local Blender execution endpoint for the gen3d MCP server.

Install as an add-on, or run: blender -b --python blender/gen3d_bridge.py -- --serve
Only use a dedicated scene: modeling jobs replace it. No third-party services.
"""
bl_info = {"name": "gen3d Blender bridge", "blender": (4, 0, 0), "category": "3D View", "version": (0, 1, 0)}

import contextlib
import io
import json
import os
import queue
import socket
import sys
import threading
import bpy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import reference_runtime as refs

_listener = None
_requests = queue.Queue()


def dispatch(request):
    try:
        if request["type"] == "get_scene_info":
            result = {"objects": [{"name": o.name, "type": o.type, "vertices": len(o.data.vertices) if o.type == "MESH" else 0} for o in bpy.context.scene.objects]}
        elif request["type"] == "inspect_reference":
            result = refs.inspect_reference(request["params"]["assetId"])
        elif request["type"] == "reuse_reference":
            result = refs.reuse_object(request["params"]["assetId"], request["params"]["objectName"])
        elif request["type"] == "execute_code":
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                exec(request["params"]["code"], {"bpy": bpy, "__builtins__": __builtins__})
            result = {"output": output.getvalue()[-50000:]}
        else:
            raise ValueError("Unknown command")
        return {"status": "success", "result": result}
    except Exception as error:
        return {"status": "error", "message": str(error)}


def handle(connection, main_thread):
    with connection:
        connection.settimeout(180)
        data = b""
        while b"\n" not in data:
            chunk = connection.recv(65536)
            if not chunk:
                return
            data += chunk
            if len(data) > 2_000_000:
                return
        request = json.loads(data.split(b"\n")[0])
        if main_thread:
            response = dispatch(request)
        else:
            event = threading.Event()
            box = []
            _requests.put((request, event, box))
            if not event.wait(180):
                response = {"status": "error", "message": "Blender main thread did not respond"}
            else:
                response = box[0]
        connection.sendall((json.dumps(response) + "\n").encode())


def serve(main_thread=False):
    global _listener
    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", int(os.environ.get("GEN3D_BLENDER_PORT", "9877"))))
    listener.listen(8)
    _listener = listener
    print("gen3d Blender bridge listening on", listener.getsockname(), flush=True)
    while _listener is listener:
        try:
            connection, _ = listener.accept()
            handle(connection, main_thread)
        except (OSError, ValueError) as error:
            if _listener is listener:
                print("gen3d bridge:", error, flush=True)


def tick():
    while not _requests.empty():
        request, event, box = _requests.get_nowait()
        box.append(dispatch(request))
        event.set()
    return 0.1 if _listener else None


class GEN3D_OT_start(bpy.types.Operator):
    bl_idname = "gen3d.start"
    bl_label = "Start gen3d bridge (dedicated scene)"

    def execute(self, context):
        if not _listener:
            threading.Thread(target=serve, daemon=True).start()
            bpy.app.timers.register(tick, first_interval=0.5, persistent=True)
        return {"FINISHED"}


class GEN3D_OT_stop(bpy.types.Operator):
    bl_idname = "gen3d.stop"
    bl_label = "Stop gen3d bridge"

    def execute(self, context):
        global _listener
        listener, _listener = _listener, None
        if listener:
            listener.close()
        return {"FINISHED"}


class GEN3D_PT_panel(bpy.types.Panel):
    bl_label = "gen3d"
    bl_idname = "GEN3D_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "gen3d"

    def draw(self, context):
        self.layout.label(text="Use a dedicated Blender scene")
        self.layout.operator("gen3d.stop" if _listener else "gen3d.start")


def register():
    for cls in (GEN3D_OT_start, GEN3D_OT_stop, GEN3D_PT_panel):
        bpy.utils.register_class(cls)


def unregister():
    GEN3D_OT_stop.execute(None, None)
    for cls in (GEN3D_PT_panel, GEN3D_OT_stop, GEN3D_OT_start):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__" and "--serve" in sys.argv:
    serve(main_thread=True)
