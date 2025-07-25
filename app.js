import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { Feed, FeedParser, Opml } from '@gaphub/feed';
import NodeFetchCache, { FileSystemCache } from 'node-fetch-cache';
import nunjucks from 'nunjucks';
import sanitizeHtml from 'sanitize-html';
import urlJoin from 'url-join';
import * as cheerio from 'cheerio';
import fs from 'fs';
import process from 'process';
import path from 'path';

const DEBUG = true;
const configFile= process.argv[2] || 'data/feeds.json';
const config = JSON.parse(fs.readFileSync(configFile));
const NOW = new Date();
const feeds = config.feeds;
const outputDir = process.argv[3] || 'html';

function debug() {
	if (DEBUG) {
		console.debug.apply(console, arguments);
	}
}

const fetch = NodeFetchCache.create({
  cache: new FileSystemCache({ttl: null}), // in ms
});

const FEED_LIMIT = 0;
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
			'srcdoc', 'srclang', 'srcset', 'start', 'step', // 'style',
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
			video: ['src', 'poster'],
			span: ['class'],
			div: ['class'],
			code: ['class'],
			kbd: ['class'],
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
const parser = new FeedParser();

function keepItemsWithValidCharacters(item) {
	return !(item?.options?.content?.text || item?.options?.description?.text)?.match(/\uFFFF/);
}

async function detectFeedInfo(entry, text, feed) {
	if (!entry.link) {
		if (feed?.options?.link) {
			entry.link = feed.options.link;
		} else {
			try {
				const xml = xmlParser.parse(text);
				if (xml?.rss?.channel?.link) {
					entry.link = xml?.rss?.channel?.link;
				} else if (xml?.rss?.channel['atom:link']) {
					if (xml?.rss?.channel['atom:link'].length) {
						for (let link of xml?.rss?.channel['atom:link']) {
							if (link['@_rel'] == 'alternate' && link['@_type'] == 'text/html') {
								entry.link = link['@_href'];
							}
						}
					} else {
						entry.link = xml?.rss?.channel['atom:link']['@_href'];
					}
				}
			} catch (err) {
				debug("Couldn't parse XML for extra info");
			}
		}
	}
	const sorted = feed.items?.filter(keepItemsWithValidCharacters)
				.filter((item) => includeItemBasedOnFeedFilter(entry, item))
				.sort((a, b) => a?.options?.date > b?.options?.date ? -1 : 1);
	if (sorted && sorted.length > 0) {
		entry.lastPostDate = sorted[0]?.options?.date?.toISOString() || '';
	} else {
		entry.lastPostDate = '';
	}
	return entry;
}

function makeRecentItemFilter(numDays) {
	const DATE_THRESHOLD = new Date();
	DATE_THRESHOLD.setDate(DATE_THRESHOLD.getDate() - numDays);
	return function includeOnlyRecentItem(item) {
		return item.options.date >= DATE_THRESHOLD;
	};
}

function includeOnlyRecentItem(item) {
	return item.options.date >= DATE_THRESHOLD;
}

function textMatches(source, re) {
	if (source) {
		const $ = cheerio.load(source, {decodeEntities: false});
		return $.text().match(re);
	} else {
		return null;
	}
}

function includeItemBasedOnFeedFilter(feedEntry, item) {
	if (feedEntry.filter) {
		const re = new RegExp(feedEntry.filter, 'i');
		let titleMatch = textMatches(item.options?.title?.text, re);
		let textMatch = textMatches(item.options?.content?.text, re);
		let descMatch = textMatches(item.options?.content?.description || item?.options?.description?.text, re);
		let catMatch = false;
		if (item.options?.category) {
			catMatch = item.options?.category.find((o) => o.name?.match(re));
		}
		return (titleMatch || textMatch || descMatch || catMatch);
	} else {
		return true;
	}
}

let dateFilter = null;
if (config.days) {
	dateFilter = makeRecentItemFilter(config.days);
}

function includeItem(feedEntry, item) {
	let result = includeItemBasedOnFeedFilter(feedEntry, item) && item.options.date <= NOW && keepItemsWithValidCharacters(item);
	if (result && dateFilter) {
		result = dateFilter(item);
	}
	return result;
}

function convertURL(base, current) {
	if (!current || current.match(/^(https?|file|ftps?|mailto|javascript|data:image\/[^;]{2,9};):/i)) {
		return current;
	} else {
		return urlJoin(base, current);
	}
}

function convertRelativeLinksToAbsolute(entry, source) {
	const $ = cheerio.load(source, {decodeEntities: false});
	$("a[href^='/'], img[src^='/'], video[src^='/']").each(function() {
    const $this = $(this);
		const base = entry.link;
		if ($this.attr('href')) {
			$this.attr("href", convertURL(base, $this.attr('href')));
		}
		if ($this.attr("src")) {
			$this.attr("src", convertURL(base, $this.attr('src')));
    }
  });
	return $.html();
}

async function fetchFeedsAndEntries(feeds) {
	return feeds.reduce(async (prev, entry) => {
		prev = await prev;
		if (entry.disabled) return prev;
		try {
			const text = await fetch(entry.feed).then((res) => res.text());
			const feed = parser.parseString(text);
			debug(entry.feed);
			prev.feedList.push(await detectFeedInfo(entry, text, feed));
			feed.items.forEach(item => {
				if (includeItem(entry, item)) {
					item.channel_link = entry.link;
					item.channel_title = entry.name;
					item.channel_name = entry.name;
					item.skipName = entry.skipName;
					item.author = item.creator || item.channel_name;
					item.date = item.options.date;
					item.isoDate = item.date.toISOString();
					item.title = item.options.title.text;
					item.link = item.options.link || item.options.id;
					item.content = convertRelativeLinksToAbsolute(entry, sanitizeHtml(item?.options?.content?.text || item?.options?.description?.text, SANITIZE_HTML_OPTIONS));
					debug('  ' + item.link);
					prev.items.push(item);
				}
				else if (!includeItemBasedOnFeedFilter(entry, item)) {
					debug('  skip filter ' + item.options.link);
				} else if (!keepItemsWithValidCharacters(item)) {
					debug('  skip invalid ' + item.options.link);
				}
			});
		} catch (err) {
			prev.errors.push(entry.feed + ' - ' + err);
			debug(entry.feed, err);
		}
		return prev;
	}, { feedList: [], items: [], errors: []});
}

function makeFeed(items) {
	const feed = new Feed({
		title: config.title,
		id: config.link,
		link: config.link,
		language: config.language,
		copyright: config.copyright,
		authors: config.authors,
		feedLinks: config.feedLinks
	});
	items.forEach((item) => {
		feed.addItem({
			title: item.channel_name && !item.skipName ? item.channel_name + ': ' + item.title : item.title,
			id: item.link,
			link: item.link,
			content: item.content,
			authors: [{name: item.options.author || item.channel_name, link: item.channel_link}],
			date: item.date
		});
	});
	return feed;
}

function escapeXml(unsafe) {
	if (!unsafe) return null;
	return unsafe.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}


function makeOPML(feedList) {
	const opml = new Opml();
	opml.setHead('title', 'Planet Emacslife');
	opml.head.ownerName = 'Sacha Chua';
	opml.head.ownerEmail = 'sacha@sachachua.com';
	feedList.forEach((entry) => {
		opml.addOutline({type: 'rss',
										 text: escapeXml(entry.name),
										 title: escapeXml(entry.name),
										 xmlUrl: escapeXml(entry.feed),
										 htmlUrl: escapeXml(entry.link)});
	});
	return opml.toString();
}

(async () => {
	let { feedList, items, errors } = await fetchFeedsAndEntries(FEED_LIMIT > 0 ? feeds.slice(0, FEED_LIMIT) : feeds);
	// Sort and limit
	feedList = feedList.sort((a, b) => a.lastPostDate > b.lastPostDate ? -1 : 1);
	items = items.sort((a, b) => a.date > b.date ? -1 : 1);
	nunjucks.configure('tmpl');
	fs.writeFileSync(path.join(outputDir, 'index.html'),
									 nunjucks.render('index.njk',
																	 { items: items,
																		 sites: feedList,
																		 name: config.title
																	 }));
	fs.writeFileSync(path.join(outputDir, 'opml.xml'), makeOPML(feedList));
	const feed = makeFeed(items);
	fs.writeFileSync(path.join(outputDir, 'atom.xml'), feed.atom1());
	fs.writeFileSync(path.join(outputDir, 'rss.xml'), feed.rss2());
	if (errors.length > 0) {
		debug('ERRORS');
		debug(errors.join('\n'));
	}
})();
