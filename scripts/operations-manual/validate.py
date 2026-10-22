"""Compatibility entry point for the rebuilt operations edition."""
from pathlib import Path
import runpy, sys
v2=Path(__file__).resolve().parent/"v2"
sys.path.insert(0,str(v2))
runpy.run_path(str(v2/"validate.py"),run_name="__main__")
