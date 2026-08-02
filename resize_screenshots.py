import os
from PIL import Image

src_dir = "store"
out_dir = "store/edge-screenshots"
os.makedirs(out_dir, exist_ok=True)

target_w, target_h = 1280, 800

for file in os.listdir(src_dir):
    if file.startswith("screenshot-") and (file.endswith(".png") or file.endswith(".jpg")):
        img = Image.open(os.path.join(src_dir, file)).convert("RGB")
        
        # Resize to fit within 1280x800, probably bounded by height 800
        img.thumbnail((target_w, target_h), Image.Resampling.LANCZOS)
        
        # Create a blank image with a dark background to pad it
        new_img = Image.new("RGB", (target_w, target_h), (28, 28, 28))
        
        # Paste the resized image into the center
        paste_x = (target_w - img.width) // 2
        paste_y = (target_h - img.height) // 2
        new_img.paste(img, (paste_x, paste_y))
        
        out_path = os.path.join(out_dir, file.replace(".jpg", ".png"))
        new_img.save(out_path, "PNG")
        print(f"Saved {out_path}")
