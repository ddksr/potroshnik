(function ($) {
	var url = null,
		deletedIds = [],
		perPage = 50,
		commands = {}, actions = {},
		dataMaps = {
			floats: {
				price: 2,
				quality: 1,
				quantity: 0
			}
		},
		dataPreparators = {
			article: function (data) {
				data.category = data.group;
				data.unitName = data.unitName.toLowerCase();
				return data;
			}
		},
		hash = function (str) {
			var hash = 0, i, chr, len;
			if (str.length == 0) return hash;
			for (i = 0, len = str.length; i < len; i++) {
				chr   = str.charCodeAt(i);
				hash  = ((hash << 5) - hash) + chr;
				hash |= 0; // Convert to 32bit integer
			}
			return hash;
		},
		connect = function (cb) {
			var after = function () {
				if (cb) { cb();	}
				refreshDOM();
				showMessage('Connected.');
			};
			url = $('#es-url').val();
			storage.set('url', url);
			req('GET', '/', null, {
				success: function () {
					req('GET', '/potroshnik', null, {
						statusCode: {
							404: function () {
								if (confirm('Potroshnik is not installed. Do you wish to install it?')) {
									install();
									after();
								}
							},
							200: function () {
								after();
							}
						}
					});
				},
				error: function () {
					alert('Could not connect to elasticsearch');
				}
			});
			window.location.href = "#/";
		},
		queries = {
			articleListAll: function (offset) {
				return {
					size: perPage,
					from: offset ? offset : 0
				};
			},
			articleList: function (x, offset) {
				return {
					query: {
						filtered: {
							filter: {
								or: [
									{ prefix: { name: x } },
									{ prefix: { group: x } },
									{ prefix: { shop: x } }
								]
							}
						}
					},
					size: perPage,
					from: offset ? offset : 0
				};
			},
			getBestArticle: function (x) {
				return {
					query: {
						filtered: {
							filter: {
								term: { category: x }
							},
							query: {
								function_score: {
									script_score : {
										script: "- doc['price'].value / doc['units'].value * doc['quality'].value"
									}
								}
							}
						}
					}
				};
			}
		},
		storage = (function () {
			if(typeof(Storage) !== "undefined") {
				return { remove: function () {}, set: function () {}, get: function (name, def) { return def; }};
			}
			return {
				get: function (name, def) {
					var val = localStorage[name];
					return val !== undefined ? val : def;
				},
				set: function (name, val) {
					localStorage.setItem(name, val);
				},
				remove: function () {
					localStorage.removeItem(name);
				}
			};
		}()),
		req = function (type, path, query, cbs) {
			var async = true,
				result = null;
			if (cbs === null) {
				async = false;
				cbs = {
					success: function (resp) {
						result = resp;
					}
				};
			}
			else if (cbs === undefined) { cbs = {}; }
			$.ajax({
				url: url + path,
				data: query ? JSON.stringify(query) : undefined,
				contentType: 'application/json',
				dataType: 'json',
				async: async,
				type: type,
				success: cbs.success || function () {},
				err: cbs.error || function () {},
				statusCode: cbs.statusCode || {}
			});
			return result;
		},
		utils = {
			getFormData: function (form, mappers) {
				var data = {};
				if (mappers === undefined) { mappers = {}; }
				$(form).find('input,textarea,select').each(function () {
					var name = $(this).attr('name'),
						map = mappers[name] || function (x) { return x; };
					if (! name) { return; }
					data[name] = map($(this).val());
				});
				return data;
			},
			createTable: function (esResponse, header, url, urlName) {
				var table = $(document.createElement('table')),
					hRow = $('<thead><tr></tr></thead>');
				if (!esResponse) { return ''; }
				if (url) {
					hRow.append('<td>' + (urlName || 'ID') + '</td>');
				}
				$.each(header, function (i, obj) {
					hRow.append('<th>' + obj.name + '</th>');
				});
				table.append(hRow);
				$.each(esResponse, function (i, obj) {
					if ($.inArray(obj._id, deletedIds) != -1) { return; }
					var row = $(document.createElement('tr'));
					if (url) {
						row.append('<td><a href="' + url + obj._id + '">' +
								   obj._source.name +
								   '</a></td>');
					}
					$.each(header, function (j, h) {
						var map = h.map || function (x) { return x; };
						row.append('<td>' + map(obj._source[h.key], obj) +  '</td>');
					});
					table.append(row);
				});
				return table.html();
			}
		},
		pagination = function (page, total) {
			var i = 0, pages = parseInt(total / perPage) + 1,
				html = '', pageName = '';
			page = parseInt(page, 10);
			if (page == pages) { return; }
			if (page > 1) {
				html += '<a href="#/page/list-articles/' + (page - 1) + '">&lsaquo;</a> ';
			}
			for (i = 1; i <= pages; i++) {
				pageName = i == page ? ('<strong>' + i + '</strong>') : i;
				html += '<a href="#/page/list-articles/' + i + '">' + pageName + '</a> ';
			}
			if (page < pages) {
				html += '<a href="#/page/list-articles/' + (page + 1) + '">&rsaquo;</a> ';
			}
			$('.pagination').html(html);
		},
		shoppingList = (function () {
			var list = [],
				addArticle = function (id, article) {
					var ulList = $('#shopping-list .shop-' + article.shop + ' ul'),
						li = $(document.createElement('li')).addClass('item'),
						name = article.name + ' ',
						units = article.units + ' ' + article.unitName + ', ',
						price = article.price.toFixed(2) + ' €';
					if(!ulList.length) {
						ulList = $(document.createElement('li'))
							.addClass('shop').addClass('shop-' + article.shop);
						ulList.append('<h3>' + article.shop + '</h3>');
						ulList.append('<ul></ul>');
						$('#shopping-list').append(ulList);
						ulList = ulList.children('ul');
					}
					li.html(name + ' (' + units + price + ')');
					ulList.append(li);
				};

			return {
				add: function (id, article) {
					list.push(article.group);
					addArticle(id, article);
				},
				clear: function () {
					list = [];
					$('#shopping-list').html('');
				},
				getList: function () {
					return list;
				},
				setList: function (newList) {
					list = newList;
				}
			};
		}()),
		showMessage = function (msg, type, container) {
			var p = $(document.createElement('p')).addClass('flakes-message');
			if (type) {	p.addClass(type); }
			p.html(msg);
			p.hide();
			$(container || '#messages').prepend(p);
			p.show('slow');
			setTimeout(function () {
				p.hide('slow', function () {
					p.remove();
				});
			}, 3000);
		},
		cache = (function () {
			var c = {},
				obtainers = {
					shop: function () {
						var elts = req('GET', '/potroshnik/shop/_search', null, null).hits.hits;
						return $.map(elts, function (elt) {
							return elt._source.name;
						});
					},
					group: function () {
						var elts = req('GET', '/potroshnik/group/_search', null, null).hits.hits;
						return $.map(elts, function (elt) {
							return elt._source.name;
						});
					}
				};
			return {
				get: function (prop) {
					if (c[prop] === undefined) {
						c[prop] = obtainers[prop]();
					}
					return c[prop];
				},
				clear: function (prop) {
					c[prop] = undefined;
				}
			};
		}()),
		refreshDOM = function () {
			$('#shops-list').html('');
			$('#groups-list').html('');
			$.each(cache.get('shop'), function (i, obj) {
				$('#shops-list').append('<option value="' + obj + '"></option>');
			});
			$.each(cache.get('group'), function (i, obj) {
				$('#groups-list').append('<option value="' + obj + '"></option>');
			});
		},
		selectPage = function (pageName, arg) {
			var fun;
			$('.page.current').removeClass('current');
			fun = $('#page-' + pageName).addClass('current').data('init');
			if (fun) {
				actions[fun].call(null, arg);
			}
		},
		checkRelated = function (data) {
			var updateCache = false,
				id = null;
			if ($.inArray(data.shop, cache.get('shop')) == -1) {
				id = 's' + hash(data.shop);
				req('PUT', '/potroshnik/shop/' + id, {
					name: data.shop
				}, null);
				updateCache = true;
			}
			if ($.inArray(data.group, cache.get('group')) == -1) {
				id = 'g' + hash(data.group);
				req('PUT', '/potroshnik/group/' + id, {
					name: data.group,
					unit: data.unitName.toLowerCase()
				}, null);
				updateCache = true;
			}
			if (updateCache) {
				cache.clear();
				refreshDOM();
			}
		},
		execCommand = function () {
			var cmd = window.location.hash.substr(2),
				segments = cmd.split('/');
			if (!cmd) { return; }
			if (!commands[segments[0]]) {
				console.error('Command does not exist');
				return;
			}
			commands[segments[0]].apply(null, segments.splice(1));
		},
		install = function () {
			req('PUT', '/potroshnik', null, null);
			req('PUT', '/potroshnik/_mapping/article', {
				"article": {
					"properties": {
						"group": { "type": "string"	},
						"category": { "type": "string", "index": "not_analyzed"	},
						"name": { "type": "string" },
						"price": { "type": "long" },
						"quality": { "type": "long"	},
						"shop": { "type": "string" },
						"unitName": { "type": "string" },
						"units": { "type": "long"	}
					}
				}
			}, null);
			req('PUT', '/potroshnik/_mapping/list', {
				"list": {
					"properties": {
						"name": { "type": "string" },
						"html": { "type": "string", "index": "not_analyzed" }
					}
				}
			}, null);
			req('PUT', '/potroshnik/_mapping/group', {
				"group": {
					"properties": {
						"name": { "type": "string" },
						"unit": { "type": "string", "index": "not_analyzed" }
					}
				}
			}, null);
			req('PUT', '/potroshnik/_mapping/shop', {
				"shop": {
					"properties": {
						"name": { "type": "string" }
					}
				}
			}, null);
		};

	url = storage.get('url', 'http://berta:9200');
	$('#es-url').val(url);
	
	commands.page = selectPage;
	commands.connect = connect;
	commands.refresh = function () {
		window.location.href = "#";
		window.location.reload();
	};
	commands.list = function (command) {
		var html = $('#shopping-list')[0].outerHTML,
			list = shoppingList.getList(),
			name = 'Shopping list ' + new Date() + ' (' + list.splice(0, 3).join(', ') + ')',
			listActions = {
				save: function () {
					req('POST', '/potroshnik/list/', {
						list: list,
						html: html,
						name: name
					}, {
						success: function (resp) {
							$('#shopping-list').data('listId', resp._id);
							setTimeout(actions.clearShoppingList, 1000);
						}
					});
				},
				remove: function () {
					var id = $('#shopping-list').data('listId');
					if (id) {
						req('DELETE', '/potroshnik/list/' + id, null, {
							success: function () {
								actions.clearShoppingList();
								deletedIds.push(id);
							}
						});
					}
				}
			};
		listActions[command]();
	};
	actions.clearShoppingList = function () {
		shoppingList.clear();
		window.location.href = "#/";
		req('GET', '/potroshnik/list/_search', null, {
			success: function (resp) {
				$('#saved-lists').html('');
				$.each(resp.hits.hits, function (i, hit) {
					if ($.inArray(hit._id, deletedIds) !== -1) { return; }
					var li = $(document.createElement('li')).addClass('shopping-list');
					li.text(hit._source.name);
					li.on('click', function () {
						shoppingList.setList(hit._source.list);
						$('#shopping-list').data('listId', hit._id);
						$('#shopping-list').html(hit._source.html);
					});
					$('#saved-lists').append(li);
				});
			}
		});
	};
	actions.addToShoppingList = function () {
		var item = $(this).find('[name="item"]');
		req('POST', '/potroshnik/article/_search', queries.getBestArticle(item.val()), {
			success: function (resp) {
				var hits = resp.hits.hits;
				if (hits.length > 0) {
					shoppingList.add(hits[0]._id, hits[0]._source);
				}
				item.val('');
			}
		});
	};
	actions.editGroup = function (id) {
		var form = this,
			oldName = null,
			oldId = null,
			data = null;
		if (id === undefined) {
			oldId = $(form).data('id');
			oldName = $(form).data('name');
			data = utils.getFormData(form);
			id = 'g' + hash(data.name);
			// save data
			req('PUT', '/potroshnik/group/' + id, data, {
				success: function (resp) {
					showMessage('Group saved', 'success');
					cache.clear();
					refreshDOM();
					if (id == oldId) { return; }
					req('DELETE', '/potroshnik/group/' + oldId, null, {
						success: function () {
							deletedIds.push('g' + hash(oldName));
						}
					});

					req('POST', '/potroshnik/article/_search', {
						query: { filtered: { filter: {
							term: { category: oldName }
						}}}
					}, {
						success: function (resp) {
							$.each(resp.hits.hits, function (i, obj) {
								req('POST', '/potroshnik/article/' + obj._id + '/_update', {
									doc: {
										group: data.name,
										category: data.name
									}
								});
							});
						}
					});
				}
			});
		} else {
			form = $('#page-edit-group form');
			form.data('id', id);
			form.find('ul input,select,textarea').val('');
			data = req('GET', '/potroshnik/group/' + id, null, null)._source;
			form.data('name', data.name);
			$.each(data, function (key, val) {
				form.find('[name="' + key + '"]').val(val + "");
			});
			form.find('legend').text('Edit group: ' + data.name);
		}
	};
	actions.editArticle = function (id) {
		var form = this,
			data = null;
		if (id === undefined) {
			id = $(form).data('id');
			data = utils.getFormData(form, { 'quality': parseFloat, 'price': parseFloat });
			checkRelated(data);
			// save data
			req('PUT', '/potroshnik/article/' + id, dataPreparators.article(data), {
				success: function (resp) {
					showMessage('Article saved', 'success');
				}
			});
		} else {
			form = $('#page-edit-article form');
			form.data('id', id);
			form.find('ul input,select,textarea').val('');
			data = req('GET', '/potroshnik/article/' + id, null, null)._source;
			$.each(data, function (key, val) {
				if (dataMaps.floats[key] != undefined) { val = val.toFixed(dataMaps.floats[key]); }
				form.find('[name="' + key + '"]').val(val + "");
			});
			form.find('legend').text('Edit article: ' + data.name);
		}
	};
	actions.showArticles = function (page) {
		var resp = {},
			queryString = this !== window ? $(this).val() : '',
			offset = 0,
			filter = queryString && queryString.length >= 3;
		page = page || 1;
		offset = (page - 1) * perPage;
		if (queryString && !filter) { return; }
		resp = req('POST', '/potroshnik/article/_search',
				   filter ? queries.articleList(queryString, offset) : queries.articleListAll(offset),
				   null);
		pagination(page, resp.hits.total);
		$('#article-list').html(utils.createTable(resp.hits.hits, [
			{ name: 'Group', key: 'group', map: function (x) {
				return '<a href="#/page/edit-group/g' + hash(x) + '">' + x + '</a>';
			} },
			{ name: 'Shop', key: 'shop' },
			{ name: 'Price', key: 'price', map: function (x) { return x.toFixed(2) + ' €'; } },
			{ name: 'Quality', key: 'quality' },
			{ name: 'Quantity', key: 'units' },
			{ name: 'Unit', key: 'unitName' }
		], '#/page/edit-article/', 'Product'));
	};
	actions.newArticle = function () {
		var form = $(this),
			data = utils.getFormData(this, { 'quality': parseFloat, 'price': parseFloat });
		checkRelated(data);
		req('POST', '/potroshnik/article/', dataPreparators.article(data), {
			success: function (resp) {
				showMessage('Article added', 'success');
				form.find('select,input,textarea').val('');
				selectPage('edit-article', resp._id);
			}
		});
	};
	actions.removeArticle = function () {
		var id = $('#page-edit-article form').data('id'),
			name = $('#page-edit-article form input[name="name"]').val();
		if (id && confirm('Do you really wish to remove article ' + name)) {
			req('DELETE', '/potroshnik/article/' + id, null, {
				success: function () {
					deletedIds.push(id);
					commands.page('list-articles');
					showMessage('Article removed.');
				}
			});
		}
	};

	execCommand();
	$(window).on('hashchange', execCommand);
	$('#article-search').on('keyup', actions.showArticles);

	$( "form" ).on( "submit", function( event ) {
		event.preventDefault();
		actions[$(this).data('callback')].apply(this);
	});

	$('.action').on('click', function () {
		actions[$(this).data('command')]();
	});

	$('.article-group').on('change', function () {
		var form = $(this).parents('form'),
			id = hash($(this).val());
		req('GET', '/potroshnik/group/g' + id, null, {
			success: function (resp) {
				form.find('[name="unitName"]').val(resp._source.unit);
			}
		});
		
	});
	connect();
}(jQuery));

