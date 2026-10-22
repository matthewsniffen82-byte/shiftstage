"""Rebuild the complete packet and its source PDFs from the current edition."""
from pathlib import Path
import runpy, sys
v2=Path(__file__).resolve().parent/"operations-manual/v2"
sys.path.insert(0,str(v2))
runpy.run_path(str(v2/"build.py"),run_name="__main__")
