import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from sync_wallpapers import sync

class WallpaperManifestTests(unittest.TestCase):
    def test_mixed_extensions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / 'wallpapers'
            src.mkdir()
            (src / 'a.jpg').write_bytes(b'jpg')
            (src / 'b.PNG').write_bytes(b'png')
            (src / 'c.txt').write_text('ignore')
            files = sync(root)
            self.assertEqual(files, ['a.jpg', 'b.PNG'])
            self.assertEqual(json.loads((root/'public/wallpapers/manifest.json').read_text()), files)
            self.assertTrue((root/'public/wallpapers/a.jpg').is_file())

if __name__ == '__main__':
    unittest.main()
