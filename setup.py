"""Include browser assets and the proposal contract in installable builds."""
from pathlib import Path
import shutil
from setuptools import setup
from setuptools.command.build_py import build_py

class BuildWithAssets(build_py):
    def run(self):
        super().run()
        root = Path(__file__).resolve().parent
        package = Path(self.build_lib) / 'tds'
        if (package / '_web').exists():
            shutil.rmtree(package / '_web')
        # Ship only the reproducible frontend build, not source, tooling or QA evidence.
        (package / '_web').mkdir(exist_ok=True)
        shutil.copy(root / 'web' / 'index.html', package / '_web' / 'index.html')
        shutil.copytree(root / 'web' / 'assets', package / '_web' / 'assets')
        (package / '_web' / 'icons').mkdir(exist_ok=True)
        for name in ('graph.svg', 'PHOSPHOR-LICENSE.txt'):
            shutil.copy(root / 'web' / 'icons' / name, package / '_web' / 'icons' / name)
        (package / '_resources').mkdir(exist_ok=True)
        shutil.copy(root / 'docs' / 'CONTRACT.md', package / '_resources' / 'CONTRACT.md')

setup(cmdclass={'build_py': BuildWithAssets})
