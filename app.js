import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { Feed, Opml } from '@gaphub/feed';
import nunjucks from 'nunjucks';
import Parser from 'rss-parser';
import sanitizeHtml from 'sanitize-html';

const ITEM_LIMIT = 50;
const SANITIZE_HTML_OPTIONS = {
		allowedTags: [
			"address", "article", "aside", "footer", "header", "h1", "h2", "h3", "h4",
			"h5", "h6", "hgroup", "main", "nav", "section", "blockquote", "dd", "div",
			"dl", "dt", "figcaption", "figure", "hr", "li", "main", "ol", "p", "pre",
			"ul", "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn",
			"em", "i", "kbd", "mark", "q", "rb", "rp", "rt", "rtc", "ruby", "s", "samp",
			"small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "caption",
			"col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr",
			"video", "track", 'img'
		],
		nonBooleanAttributes: [
			'abbr', 'accept', 'accept-charset', 'accesskey', 'action',
			'allow', 'alt', 'as', 'autocapitalize', 'autocomplete',
			'blocking', 'charset', 'cite', 'class', 'color', 'cols',
			'colspan', 'content', 'contenteditable', 'coords', 'crossorigin',
			'data', 'datetime', 'decoding', 'dir', 'dirname', 'download',
			'draggable', 'enctype', 'enterkeyhint', 'fetchpriority', 'for',
			'form', 'formaction', 'formenctype', 'formmethod', 'formtarget',
			'headers', 'height', 'hidden', 'high', 'href', 'hreflang',
			'http-equiv', 'id', 'imagesizes', 'imagesrcset', 'inputmode',
			'integrity', 'is', 'itemid', 'itemprop', 'itemref', 'itemtype',
			'kind', 'label', 'lang', 'list', 'loading', 'low', 'max',
			'maxlength', 'media', 'method', 'min', 'minlength', 'name',
			'nonce', 'optimum', 'pattern', 'ping', 'placeholder', 'popover',
			'popovertarget', 'popovertargetaction', 'poster', 'preload',
			'referrerpolicy', 'rel', 'rows', 'rowspan', 'sandbox', 'scope',
			'shape', 'size', 'sizes', 'slot', 'span', 'spellcheck', 'src',
			'srcdoc', 'srclang', 'srcset', 'start', 'step', 'style',
			'tabindex', 'target', 'title', 'translate', 'type', 'usemap',
			'value', 'width', 'wrap',
			// Event handlers
			'onauxclick', 'onafterprint', 'onbeforematch', 'onbeforeprint',
			'onbeforeunload', 'onbeforetoggle', 'onblur', 'oncancel',
			'oncanplay', 'oncanplaythrough', 'onchange', 'onclick', 'onclose',
			'oncontextlost', 'oncontextmenu', 'oncontextrestored', 'oncopy',
			'oncuechange', 'oncut', 'ondblclick', 'ondrag', 'ondragend',
			'ondragenter', 'ondragleave', 'ondragover', 'ondragstart',
			'ondrop', 'ondurationchange', 'onemptied', 'onended',
			'onerror', 'onfocus', 'onformdata', 'onhashchange', 'oninput',
			'oninvalid', 'onkeydown', 'onkeypress', 'onkeyup',
			'onlanguagechange', 'onload', 'onloadeddata', 'onloadedmetadata',
			'onloadstart', 'onmessage', 'onmessageerror', 'onmousedown',
			'onmouseenter', 'onmouseleave', 'onmousemove', 'onmouseout',
			'onmouseover', 'onmouseup', 'onoffline', 'ononline', 'onpagehide',
			'onpageshow', 'onpaste', 'onpause', 'onplay', 'onplaying',
			'onpopstate', 'onprogress', 'onratechange', 'onreset', 'onresize',
			'onrejectionhandled', 'onscroll', 'onscrollend',
			'onsecuritypolicyviolation', 'onseeked', 'onseeking', 'onselect',
			'onslotchange', 'onstalled', 'onstorage', 'onsubmit', 'onsuspend',
			'ontimeupdate', 'ontoggle', 'onunhandledrejection', 'onunload',
			'onvolumechange', 'onwaiting', 'onwheel'
		],
		disallowedTagsMode: 'discard',
		allowedAttributes: {
			a: ['href', 'name', 'target'],
			video: ['src'],
			// We don't currently allow img itself by default, but
			// these attributes would make sense if we did.
			img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading']
		},
		// Lots of these won't come up by default because we don't allow them
		selfClosing: ['img', 'br', 'hr', 'area', 'base', 'basefont', 'input', 'link', 'meta'],
		// URL schemes we permit
		allowedSchemes: ['http', 'https', 'ftp', 'mailto', 'tel'],
		allowedSchemesByTag: {},
		allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
		allowProtocolRelative: true,
		enforceHtmlBoundary: false,
		parseStyleAttributes: true
};

const xmlParser = new XMLParser({ignoreAttributes: false});
const parser = new Parser();
import fs from 'fs';

const feeds = JSON.parse(fs.readFileSync('data/feeds.json'));

async function detectFeedInfo(entry, text, feed) {
	const xml = xmlParser.parse(text);
	if (!entry.link) {
		if (xml?.rss?.channel?.link) {
			entry.link = xml?.rss?.channel?.link;
		} else {
			if (xml?.rss?.channel['atom:link']) {
				for (let link of xml?.rss?.channel['atom:link']) {
					if (link['@_rel'] == 'alternate' && link['@_type'] == 'text/html') {
						entry.link = link['@_href'];
					}
				}
			}
		}
	}
	const sorted = feed.items?.sort((a, b) => a.isoDate > b.isoDate ? -1 : 1);
	if (sorted) {
		entry.lastPostDate = sorted[0].isoDate;
	}
	return entry;
}

async function fetchFeedsAndEntries(feeds) {
	return feeds.reduce(async (prev, entry) => {
		prev = await prev;
		const text = await fetch(entry.feed).then((res) => res.text());
		try {
			const feed = await parser.parseString(text);
			prev.feedList.push(await detectFeedInfo(entry, text, feed));
			console.debug(entry.feed);
			feed.items.forEach(item => {
				console.debug('  ' + item.link);
				item.channel_link = entry.link;
				item.channel_title = entry.name;
				item.channel_name = entry.name;
				item.author = item.creator || item.channel_name;
				item.date = item.isoDate;
				if (item.isoDate) {
					item.content = sanitizeHtml(item.content, SANITIZE_HTML_OPTIONS);

					if (item.contentSnippet) {
						delete item.contentSnippet;
					}
					prev.items.push(item);
				}
			});
		} catch (err) {
			console.log(entry.feed, err);
		}
		return prev;
	}, { feedList: [], items: [] });
}

function makeOPML(feedList) {
	const opml = new Opml();
	opml.setHead('title', 'Planet Emacslife');
	opml.head.ownerName = 'Sacha Chua';
	opml.head.ownerEmail = 'sacha@sachachua.com';
	feedList.forEach((entry) => {
		opml.addOutline({type: 'rss',
										 text: entry.name,
										 title: entry.name,
										 xmlUrl: entry.feed,
										 htmlUrl: entry.link});
	});
	return opml.toString();
}

(async () => {
	let { feedList, items } = await fetchFeedsAndEntries(feeds);
	// Sort and limit
	feedList = feedList.sort((a, b) => a.name < b.name ? -1 : 1);
	items = items.sort((a, b) => a.isoDate > b.isoDate ? -1 : 1).slice(0, ITEM_LIMIT);
	nunjucks.configure('tmpl');
	fs.writeFileSync('html/index.html', nunjucks.render('index.njk', { items: items, sites: feedList }));
	fs.writeFileSync('html/opml.xml', await makeOPML(feedList));

})();
