# -*- coding: utf-8 -*-

from mylibs import theqrmodule
from PIL import Image
from collections import defaultdict
from functools import wraps
from datetime import date
from StringIO import StringIO
import os, traceback, sys, shutil, time, json, uuid, urllib, urllib2, urlparse, gzip
import numpy, imageio, boto3

# Globals
max_image_size = 10
default_user_agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.113 Safari/537.36'
fb_url = "https://graph.facebook.com/v2.7/me/messages?access_token=<YOUR TOKEN>"
align_location = [(6, 18), (6, 22), (6, 26), (6, 30), (6, 34), (6, 22, 38), (6, 24, 42), (6, 26, 46), (6, 28, 50), (6, 30, 54), (6, 32, 58), (6, 34, 62), (6, 26, 46, 66), (6, 26, 48, 70), (6, 26, 50, 74), (6, 30, 54, 78), (6, 30, 56, 82), (6, 30, 58, 86), (6, 34, 62, 90), (6, 28, 50, 72, 94), (6, 26, 50, 74, 98), (6, 30, 54, 78, 102), (6, 28, 54, 80, 106), (6, 32, 58, 84, 110), (6, 30, 58, 86, 114), (6, 34, 62, 90, 118), (6, 26, 50, 74, 98, 122), (6, 30, 54, 78, 102, 126), (6, 26, 52, 78, 104, 130), (6, 30, 56, 82, 108, 134), (6, 34, 60, 86, 112, 138), (6, 30, 58, 86, 114, 142), (6, 34, 62, 90, 118, 146), (6, 30, 54, 78, 102, 126, 150), (6, 24, 50, 76, 102, 128, 154), (6, 28, 54, 80, 106, 132, 158), (6, 32, 58, 84, 110, 136, 162), (6, 26, 54, 82, 110, 138, 166), (6, 30, 58, 86, 114, 142, 170)]
aligns = defaultdict(bool)

def retry(ExceptionToCheck, tries=4, delay=3, backoff=2):
    def deco_retry(f):

        @wraps(f)
        def f_retry(*args, **kwargs):
            mtries, mdelay = tries, delay
            while mtries > 1:
                try:
                    return f(*args, **kwargs)
                except ExceptionToCheck, e:
                    print e.read()
                    print "%s, Retrying in %d seconds..." % (str(e), mdelay)
                    time.sleep(mdelay)
                    mtries -= 1
                    mdelay *= backoff
            return f(*args, **kwargs)

        return f_retry  # true decorator

    return deco_retry

def make_aligns(version):
    aligns.clear() # NOTE: To make sure it's cleared upon memory reuse
    if version > 1:
        aloc = align_location[version-2]
        for a in range(len(aloc)):
            for b in range(len(aloc)):
                if not ((a==b==0) or (a==len(aloc)-1 and b==0) or (a==0 and b==len(aloc)-1)):
                    for i in range(3*(aloc[a]-2), 3*(aloc[a]+3)):
                        for j in range(3*(aloc[b]-2), 3*(aloc[b]+3)):
                            aligns[(i,j)]=True

def combine(qr, bg):
    t1 = time.time()

    if bg.size[0] < bg.size[1]:
        bg = bg.resize((qr.size[0]-24, (qr.size[0]-24)*int(bg.size[1]/bg.size[0])))
    else:
        bg = bg.resize(((qr.size[1]-24)*int(bg.size[0]/bg.size[1]), qr.size[1]-24))

    for i in range(qr.size[0]-24):
        for j in range(qr.size[1]-24):
            if not ((i<24 and j<24) or (i in (18,19,20)) or (j in (18,19,20)) or (i<24 and j>qr.size[1]-49) or (i>qr.size[0]-49 and j<24) or (aligns[(i,j)]==True) or (i%3==1 and j%3==1) or (bg.getpixel((i,j))[3]==0)):
                qr.putpixel((i+12,j+12), bg.getpixel((i,j)))

    qr = qr.resize((qr.size[0]*3, qr.size[1]*3))
    print 'Processing time ->', time.time()-t1
    return qr

@retry(urllib2.URLError, tries=3, delay=3, backoff=2)
def save_to_path(url, path):
    req = urllib2.Request(url)
    req.add_header('User-Agent', default_user_agent)
    req.add_header('Accept-encoding', 'gzip')
    con = urllib2.urlopen(req)
    # Handle compression
    enc_gzip = con.info().get('Content-Encoding') == 'gzip'
    with open(path, "wb") as tmp_file:
        buf = StringIO(con.read())
        data = gzip.GzipFile(fileobj=buf) if enc_gzip else buf
        tmp_file.write(data.read())

def send_msg(userid, msg):
    data = {"recipient": {"id": userid}, "message": {"text": msg}}
    req = urllib2.Request(fb_url, json.dumps(data), {"Content-Type": "application/json"})
    urllib2.urlopen(req)

@retry(urllib2.URLError, tries=3, delay=3, backoff=2)
def send_image(userid, image_url):
    data = {"recipient": {"id": userid}, "message": {"attachment": {"type": "image", "payload": {"url": image_url}}}}
    req = urllib2.Request(fb_url, json.dumps(data), {"Content-Type": "application/json"})
    urllib2.urlopen(req)

# Lambda handler
def lambda_handler(event, context):
    try:
        print 'src event -> ',event
        # Create unique folder
        save_place = '/tmp/'+str(uuid.uuid4())
        os.mkdir(save_place)
        result = {}

        # Initialize parameters
        event['version'] = int(event['version']) if 'version' in event else 0
        event['level'] = event['level'] if 'level' in event else 'H'
        event['text'] = event['text'] if 'text' in event else 'Content'
        event['picture'] = event['picture'] if 'picture' in event else None

        # Check user ID
        if not 'userid' in event:
            raise TypeError('Missing user id')

        # Check image
        if event['picture']:
            print 'Get picture HEAD.'
            req = urllib2.Request(event['picture'])
            req.get_method = lambda : 'HEAD'
            try:
                resp = urllib2.urlopen(req)
                event['picture-type'] = resp.info().getheader('Content-Type').split(',')[0] # Sometimes I get 'image/png, image/png'
            except:
                # HEAD not supported?
                image_path = urlparse.urlparse(event['picture']).path.lower()
                image_ext = os.path.splitext(image_path)[1]
                if image_ext in ['.png', '.jpg', '.gif']:
                    event['picture-type'] = {'.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif'}[image_ext]

            if (not 'picture-type' in event) or (not event['picture-type'] in ['image/gif', 'image/jpeg', 'image/png']):
                raise TypeError('invalid image type')

            print 'Content-Type -> '+event['picture-type']

        # Create QR image
        send_msg(event['userid'], 'Creating your code...\nIt may take a few seconds or a minute.')

        event['version'], qr_name = theqrmodule.get_qrcode(event['version'], event['level'], event['text'], save_place)

        print 'final event -> ',event

        # Make alignment pattern dict
        if event['picture']:
            make_aligns(event['version'])

        if event['picture'] and event['picture-type']=='image/gif':
            tmp_source = save_place+'/src.gif'
            save_to_path(event['picture'], tmp_source)
            event['picture']=tmp_source

            qr_image = Image.open(qr_name)
            durations = []
            frames = []
            reader = imageio.get_reader(event['picture'])
            count = len(reader)
            for i, frame in enumerate(reader):
                try:
                    duration = frame.meta['ANIMATION']['FrameTime']
                except:
                    duration = 100
                finally:
                    durations.append(duration/1000.0)
                print 'Frame', i, '/', count-1
                frames.append(numpy.array(combine(qr_image.convert('RGBA'), Image.fromarray(frame, 'RGBA'))))
            qr_name = save_place+'/qr.gif'
            imageio.mimwrite(qr_name, frames, 'GIF', duration=durations)

        elif event['picture']:
            tmp_source = save_place+'/src'+{'image/png': '.png', 'image/jpeg': '.jpg'}[event['picture-type']]
            print 'tmp_source -> '+tmp_source
            save_to_path(event['picture'], tmp_source)
            event['picture']=tmp_source

            qr = combine(Image.open(qr_name).convert('RGBA'), Image.open(tmp_source).convert('RGBA'))
            qr_name = save_place+'/qr'+{'image/png': '.png', 'image/jpeg': '.jpg'}[event['picture-type']]
            qr.save(qr_name)

        elif qr_name:
            event['picture-type']='image/png'
            qr = Image.open(qr_name)
            qr.resize((qr.size[0]*3, qr.size[1]*3)).save(qr_name)

        if qr_name:
            print 'Ready! '+str(event['version'])+'-'+str(event['level'])+' QR code saved to '+qr_name
            qr_stat = os.stat(qr_name)
            # Check image size [MB]
            if qr_stat.st_size/(1024*1024) < max_image_size:
                s3_client = boto3.client('s3')
                s3_bucket = '<YOUR BUCKET>'
                s3_dir = '<UPLOAD FOLDER>'
                today_key = date.today().strftime('%Y%m/%d')
                s3_key = s3_dir+'/'+today_key+'/'+str(uuid.uuid4())+qr_name[-4:]
                s3_client.upload_file(qr_name, s3_bucket, s3_key, ExtraArgs={'ContentType': event['picture-type'], 'ACL':'public-read'})
                image_url = 'https://%s.s3.amazonaws.com/%s' % (s3_bucket, s3_key)
                print image_url
                send_msg(event['userid'], 'Here we go :)')
                send_image(event['userid'], image_url)
                result = {'url': image_url}
            else:
                result = {'error': 'the resulting image size exceeds limit (%dMB)' % max_image_size}
    except:
        exc_type, exc_value = sys.exc_info()[:2]
        result = {'error': str(exc_value)}
        traceback.print_exc()
    finally:
        print 'Cleanup.'
        shutil.rmtree(save_place)

    if 'error' in result or not 'url' in result:
        err = 'Yay, something went wrong :('
        if 'error' in result:
            err = err+'\n('+result['error']+')'
        send_msg(event['userid'], err)
    return result
