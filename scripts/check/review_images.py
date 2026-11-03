"""目で確認した画像のハッシュを demo-data/image-review.json に記録する。

  python review_images.py demo-data/sample-b

check_public.py は、ここに記録された内容と違う画像があると止める。
"""
import hashlib
import json
import sys

from common import REPO

path = REPO / "demo-data" / "image-review.json"
reviewed = json.loads(path.read_text()) if path.exists() else {}
for folder in sys.argv[1:]:
    # 消えた画像の記録は残さない
    reviewed = {k: v for k, v in reviewed.items() if not k.startswith(folder.rstrip("/") + "/")}
    for image in sorted((REPO / folder).rglob("*.png")):
        reviewed[str(image.relative_to(REPO))] = hashlib.sha256(image.read_bytes()).hexdigest()
path.write_text(json.dumps(dict(sorted(reviewed.items())), indent=1))
print(f"{len(reviewed)} 件を記録しました")
