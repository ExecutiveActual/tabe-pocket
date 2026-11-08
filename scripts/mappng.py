# Preview a map as a PNG (1 px per tile). Usage: python3 scripts/mappng.py data/maps/tabe_big out.png
import json,sys
from PIL import Image
base=sys.argv[1] if len(sys.argv)>1 else 'data/maps/tabe_big'
rows=[r for r in open(base+'.txt').read().split('\n') if r]
d=json.load(open(base+'.meta.json'))
C={'~':(42,93,124),'.':(217,197,139),',':(122,163,90),'J':(47,100,45),'o':(196,160,100),'m':(80,110,80),'h':(140,130,100),'^':(110,105,100),'p':(74,134,168),'s':(91,156,192)}
n=len(rows); im=Image.new('RGB',(n,n)); px=im.load()
for y,r in enumerate(rows):
  for x,c in enumerate(r): px[x,y]=C[c]
def mark(x,y,c):
  for dx in range(-4,5):
    for dy in range(-4,5):
      if 0<=x+dx<n and 0<=y+dy<n: px[x+dx,y+dy]=c
mark(*d['landing'],(255,0,0))
for x,y in d['rookeries']: mark(x,y,(255,255,0))
im.save(sys.argv[2] if len(sys.argv)>2 else 'shots/map_big.png')
